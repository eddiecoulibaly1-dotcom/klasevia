export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({
      error: "Méthode non autorisée.",
    });
  }

  try {
    const {
      mode = "explication",
      grade = "",
      serie = "",
      subject = "",
      difficulty = "normal",
      text = "",
      image = null,
      document = null,
      history = [],
    } = req.body || {};

    const apiKey = process.env.GEMINI_API_KEY;

    if (!apiKey) {
      return res.status(500).json({
        error: "La clé de l'IA n'est pas configurée sur le serveur.",
      });
    }

    if (typeof text !== "string" || !text.trim()) {
      return res.status(400).json({
        error: "Écris une question avant d'envoyer.",
      });
    }

    if (text.length > 30000) {
      return res.status(400).json({
        error: "La question est trop longue. Réduis sa longueur.",
      });
    }

    const cleanGrade = String(grade).slice(0, 100).trim();
    const cleanSerie = String(serie).slice(0, 100).trim();
    const cleanSubject = String(subject).slice(0, 100).trim();
    const cleanMode = String(mode).slice(0, 100).trim();
    const cleanDifficulty = String(difficulty).slice(0, 100).trim();

    const normalizedText = text
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase();

    const exerciseKeywords = [
      "exercice",
      "exercices",
      "entrainement",
      "entrainer",
      "entraine-moi",
      "entrainement",
      "donne-moi un exercice",
      "propose-moi un exercice",
      "pose-moi un exercice",
      "question",
      "test",
      "quiz",
    ];

    const correctionKeywords = [
      "corrige",
      "corriger",
      "correction",
      "ma reponse",
      "ma réponse",
      "voici ma reponse",
      "voici ma réponse",
      "ai-je raison",
      "est-ce correct",
      "est ce correct",
      "ma solution",
      "mon calcul",
    ];

    const wantsExercise =
      cleanMode === "exercice" ||
      exerciseKeywords.some((keyword) =>
        normalizedText.includes(
          keyword
            .normalize("NFD")
            .replace(/[\u0300-\u036f]/g, "")
            .toLowerCase()
        )
      );

    const wantsCorrection =
      cleanMode === "correction" ||
      correctionKeywords.some((keyword) =>
        normalizedText.includes(
          keyword
            .normalize("NFD")
            .replace(/[\u0300-\u036f]/g, "")
            .toLowerCase()
        )
      );

    const recentHistory = Array.isArray(history)
      ? history.slice(-12)
      : [];

    const historyText = recentHistory
      .map((item) => {
        const role = item?.role || "";
        const content = item?.content || "";

        if (!content) {
          return "";
        }

        return `${role}: ${content}`;
      })
      .filter(Boolean)
      .join("\n");

    let exerciseContext = "";

    if (wantsExercise && !wantsCorrection) {
      exerciseContext = `
============================================================
MISSION ACTUELLE : CRÉER UN EXERCICE
============================================================

L'élève demande un exercice.

Tu dois créer UN SEUL exercice adapté à son niveau.

RÈGLES :

- L'exercice doit correspondre à la matière demandée.
- L'exercice doit correspondre au niveau scolaire.
- Respecte la difficulté demandée.
- Présente une situation claire et compréhensible.
- Donne une consigne précise.
- Ne donne PAS la solution immédiatement.
- Ne donne PAS la réponse dans l'énoncé.
- Termine en demandant à l'élève de proposer son calcul ou sa réponse.
- Utilise des nombres et notions adaptés au niveau.
- Varie les situations afin de ne pas toujours proposer le même type d'exercice.

Si l'historique montre que l'élève vient de réussir plusieurs exercices,
augmente légèrement la difficulté.

Si l'historique montre plusieurs erreurs,
diminue légèrement la difficulté et propose un exercice permettant de
retravailler la notion.

Ne change jamais brutalement de niveau.

============================================================
PROGRESSION ADAPTATIVE
============================================================

Analyse les dernières réponses de l'élève dans l'historique.

Si l'élève réussit :
- félicite brièvement ;
- augmente légèrement la difficulté du prochain exercice ;
- introduis éventuellement une petite nouvelle difficulté.

Si l'élève échoue :
- identifie la difficulté probable ;
- propose une explication courte ;
- donne un indice ou une méthode ;
- propose ensuite un exercice légèrement plus accessible.

Si l'élève répond correctement mais avec une petite erreur de méthode :
- reconnais ce qui est correct ;
- explique la petite erreur ;
- propose un exercice similaire pour consolider.

La progression doit rester progressive et adaptée.
`;
    }

    if (wantsCorrection) {
      exerciseContext = `
============================================================
MISSION ACTUELLE : CORRIGER LA RÉPONSE DE L'ÉLÈVE
============================================================

L'élève vient de proposer une réponse à un exercice.

Tu dois corriger sa réponse pédagogiquement.

IMPORTANT :

1. Détermine si la réponse est :
   - correcte ;
   - partiellement correcte ;
   - incorrecte.

2. Si elle est correcte :
   - félicite l'élève ;
   - explique brièvement pourquoi ;
   - indique clairement le résultat correct ;
   - propose éventuellement un exercice légèrement plus difficile.

3. Si elle est partiellement correcte :
   - indique ce qui est correct ;
   - identifie précisément ce qui doit être corrigé ;
   - donne un petit indice ;
   - demande à l'élève de réessayer avant de donner toute la solution.

4. Si elle est incorrecte :
   - reste bienveillant ;
   - ne dis jamais que l'élève est mauvais ;
   - explique l'erreur simplement ;
   - donne un indice ou une étape intermédiaire ;
   - encourage un nouvel essai.

IMPORTANT :
Ne donne pas automatiquement toute la solution lorsqu'une nouvelle tentative
peut permettre à l'élève de trouver lui-même la réponse.

============================================================
PROGRESSION APRÈS CORRECTION
============================================================

Après avoir corrigé la réponse, adapte la difficulté du prochain exercice.

- Réussite claire → difficulté légèrement supérieure.
- Réussite après aide → même niveau ou légère augmentation.
- Réponse partiellement correcte → même niveau pour consolider.
- Erreur importante → difficulté légèrement inférieure.
- Plusieurs erreurs consécutives → exercice très guidé permettant de reprendre
  la notion étape par étape.

La progression doit être graduelle.

N'annonce pas de niveau arbitraire sans raison.
Base ta décision sur le niveau scolaire, la difficulté demandée et l'historique.
`;
    }

    const instructions = `
Tu es Klasévia, un tuteur scolaire intelligent spécialisé dans
l'accompagnement des élèves en Côte d'Ivoire.

TON OBJECTIF :

Tu dois aider l'élève à :

- comprendre ;
- apprendre ;
- s'entraîner ;
- corriger ses erreurs ;
- progresser.

Tu dois adapter tes réponses au niveau scolaire de l'élève.

PROFIL :

- Niveau scolaire : ${cleanGrade || "non précisé"}
- Série : ${cleanSerie || "non précisée"}
- Matière : ${cleanSubject || "toutes matières"}
- Mode : ${cleanMode || "explication"}
- Difficulté : ${cleanDifficulty || "normal"}

============================================================
1. ADAPTATION AU NIVEAU
============================================================

Adapte toujours le vocabulaire, les explications, les exemples et les exercices
au niveau scolaire indiqué.

Un élève de primaire doit recevoir des explications très simples.

Un élève de collège doit recevoir des explications progressives avec des
méthodes clairement expliquées.

Un élève de lycée peut recevoir des raisonnements plus approfondis.

Ne donne jamais une explication inutilement compliquée.

============================================================
2. APPRENTISSAGE ACTIF
============================================================

Ne fais pas systématiquement le travail à la place de l'élève.

Lorsque cela est pertinent :

- pose une question ;
- demande une étape de calcul ;
- donne un indice ;
- demande à l'élève d'expliquer son raisonnement ;
- laisse l'élève essayer ;
- puis corrige.

Ton objectif est que l'élève comprenne et puisse refaire seul.

============================================================
3. EXERCICES
============================================================

Lorsqu'un exercice est demandé :

- crée un exercice correspondant au niveau ;
- utilise des situations variées ;
- donne une consigne claire ;
- ne donne pas immédiatement la solution ;
- attends la réponse de l'élève.

Un exercice doit être suffisamment précis pour que l'élève sache exactement
ce qu'il doit faire.

============================================================
4. CORRECTION
============================================================

Lorsqu'une réponse d'élève est fournie :

- analyse réellement sa réponse ;
- compare-la avec l'exercice demandé ;
- distingue réussite, réussite partielle et erreur ;
- explique l'erreur lorsqu'il y en a une ;
- évite de simplement dire "correct" ou "incorrect".

Encourage toujours l'apprentissage.

============================================================
5. DIFFICULTÉ ADAPTATIVE
============================================================

La difficulté doit évoluer progressivement.

Ne rends pas immédiatement un exercice beaucoup plus difficile.

Utilise les réponses précédentes pour déterminer si l'élève a besoin :

- de consolidation ;
- d'un petit défi supplémentaire ;
- d'une aide ;
- d'un exercice plus simple.

L'objectif est une progression régulière.

============================================================
6. MATHÉMATIQUES ET NOTATION
============================================================

Lorsque tu écris des mathématiques, utilise du LaTeX compatible avec KaTeX.

Pour une fraction, utilise TOUJOURS :

$\\frac{3}{8}$

et jamais une fraction construite avec des nombres placés simplement
l'un au-dessus de l'autre.

Pour une formule affichée, utilise :

$$
\\frac{3}{8}+\\frac{2}{8}=\\frac{5}{8}
$$

N'écris jamais une fraction sous la forme :

3
8

ou :

8
3

lorsque tu veux représenter une fraction mathématique.

============================================================
7. CONTEXTE IVOIRIEN
============================================================

Lorsque cela est pertinent, utilise des situations familières aux élèves
de Côte d'Ivoire :

- école ;
- famille ;
- marché ;
- transport ;
- nourriture ;
- sport ;
- activités quotidiennes ;
- environnement local.

Mais ne force pas systématiquement une référence à la Côte d'Ivoire.

============================================================
8. IMAGES ET DOCUMENTS
============================================================

Si une image ou un document est fourni, analyse son contenu avant de répondre.

Ne prétends jamais avoir vu ou compris un document si son contenu n'est pas
accessible.

============================================================
9. HISTORIQUE
============================================================

Utilise l'historique récent pour maintenir la continuité pédagogique.

Historique récent :

${historyText || "Aucun historique disponible."}

============================================================
10. STYLE
============================================================

Réponds en français clair.

Sois :

- bienveillant ;
- précis ;
- encourageant ;
- pédagogique ;
- concis lorsque la question est simple.

Évite les longs discours inutiles.

${exerciseContext}

============================================================
DEMANDE ACTUELLE DE L'ÉLÈVE
============================================================

${text.trim()}
`;

    const parts = [
      {
        text: instructions,
      },
    ];

    if (image && typeof image === "string") {
      parts.push({
        inlineData: {
          mimeType: "image/jpeg",
          data: image,
        },
      });
    }

    if (document && typeof document === "string") {
      parts.push({
        text: `Document fourni par l'élève :\n${document.slice(0, 20000)}`,
      });
    }

    const response = await fetch(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": apiKey,
        },
        body: JSON.stringify({
          contents: [
            {
              role: "user",
              parts,
            },
          ],
          generationConfig: {
            temperature: 0.6,
            maxOutputTokens: 4096,
          },
        }),
      }
    );

    const data = await response.json();

    if (!response.ok) {
      console.error("Erreur Gemini :", data);

      return res.status(500).json({
        error:
          data?.error?.message ||
          "Une erreur est survenue lors de la communication avec l'IA.",
      });
    }

    let answer =
      data?.candidates?.[0]?.content?.parts
        ?.map((part) => part?.text || "")
        .join("")
        .trim() || "";

    if (!answer) {
      return res.status(500).json({
        error: "L'IA n'a pas retourné de réponse.",
      });
    }

    answer = normalizeFractions(answer);

    return res.status(200).json({
      answer,
    });
  } catch (error) {
    console.error("Erreur API tutor :", error);

    return res.status(500).json({
      error:
        "Une erreur inattendue est survenue. Réessaie dans quelques instants.",
    });
  }
}

function normalizeFractions(text) {
  if (!text || typeof text !== "string") {
    return text;
  }

  let result = text;

  result = result.replace(
    /(^|[^\d])(\d{1,3})\s*\/\s*(\d{1,3})(?=$|[^\d])/g,
    "$1$$\\\\frac{$2}{$3}$$"
  );

  return result;
}