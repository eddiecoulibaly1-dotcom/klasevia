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
      "donne-moi un exercice",
      "propose-moi un exercice",
      "pose-moi un exercice",
      "question",
      "test",
      "quiz",
      "entrainement",
    ];

    const correctionKeywords = [
      "corrige",
      "corriger",
      "correction",
      "ma reponse",
      "voici ma reponse",
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
MISSION ACTUELLE : CRÉER UN EXERCICE INTERACTIF
============================================================

L'élève demande un exercice.

Tu dois créer UN SEUL exercice adapté à son niveau.

Tu dois d'abord choisir le TYPE D'EXERCICE le plus pertinent.

TYPES DISPONIBLES :

1. CALCUL
Utilise ce type lorsque l'objectif est de calculer directement.

Exemples :
- opérations ;
- fractions ;
- pourcentages ;
- puissances ;
- conversions ;
- calcul littéral.

2. PROBLÈME
Utilise ce type lorsqu'une situation demande plusieurs étapes de raisonnement.

Exemples :
- achats ;
- monnaie ;
- distances ;
- proportions ;
- géométrie appliquée ;
- situations de la vie quotidienne.

3. RÉPONSE COURTE
Utilise ce type lorsqu'une réponse concise suffit.

Exemples :
- définition ;
- propriété ;
- résultat ;
- vocabulaire ;
- notion de cours.

4. RAISONNEMENT
Utilise ce type lorsque l'objectif principal est d'expliquer ou de justifier.

Exemples :
- expliquer pourquoi ;
- justifier une réponse ;
- comparer deux résultats ;
- démontrer une propriété simple.

5. COMPRÉHENSION
Utilise ce type lorsqu'un texte, une situation ou un document doit être
compris avant de répondre.

Exemples :
- compréhension de texte ;
- lecture ;
- analyse d'un document ;
- extraction d'informations.

6. SCIENCES
Utilise ce type pour les matières scientifiques lorsque l'activité demande
une observation, une interprétation, une classification ou une explication.

7. LANGUES
Utilise ce type pour :
- grammaire ;
- conjugaison ;
- vocabulaire ;
- orthographe ;
- compréhension ;
- expression.

============================================================
CHOIX DU TYPE
============================================================

Choisis le type en fonction :

- de la matière ;
- du niveau scolaire ;
- de la demande de l'élève ;
- de la notion étudiée ;
- de l'historique récent.

Ne demande pas à l'élève de choisir le type si ce n'est pas nécessaire.

Le type doit servir l'objectif pédagogique.

Ne choisis pas systématiquement "calcul".

============================================================
FORMAT DE L'EXERCICE
============================================================

Présente l'exercice de façon claire.

Tu peux utiliser cette structure :

### Exercice

**Type :** [type d'exercice]

[Situation ou question]

### Consigne

[Ce que l'élève doit faire]

### À toi de jouer

[Invitation à répondre]

IMPORTANT :

- UN SEUL exercice à la fois.
- Ne donne PAS la solution immédiatement.
- Ne donne PAS la réponse dans l'énoncé.
- La consigne doit être précise.
- L'élève doit pouvoir répondre facilement dans la conversation.

============================================================
VARIATION
============================================================

Évite de générer plusieurs fois exactement le même exercice.

Si l'élève a déjà fait un problème d'achat, propose une autre situation.

Si l'élève a déjà travaillé un calcul direct, propose parfois un problème ou
un exercice de raisonnement lorsque cela est pertinent.

Varie progressivement les formes d'entraînement.

============================================================
PROGRESSION ADAPTATIVE
============================================================

Analyse les dernières réponses de l'élève dans l'historique.

Si l'élève réussit :
- félicite brièvement ;
- augmente légèrement la difficulté ;
- introduis éventuellement une nouvelle difficulté.

Si l'élève échoue :
- identifie la difficulté probable ;
- propose une explication courte ;
- donne un indice ;
- propose ensuite un exercice légèrement plus accessible.

Si l'élève répond correctement mais avec une petite erreur de méthode :
- reconnais ce qui est correct ;
- explique la petite erreur ;
- propose un exercice similaire pour consolider.

La progression doit rester progressive.

Ne rends jamais un exercice brutalement beaucoup plus difficile.
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

============================================================
TYPE DU PROCHAIN EXERCICE
============================================================

Ne propose pas toujours le même type d'exercice.

Après plusieurs exercices du même type, lorsque cela est pédagogiquement
pertinent, varie la forme :

- calcul ;
- problème ;
- réponse courte ;
- raisonnement ;
- compréhension ;
- sciences ;
- langues.

La variation doit rester cohérente avec la matière et le niveau scolaire.
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
3. EXERCICES INTERACTIFS
============================================================

Lorsqu'un exercice est demandé :

- choisis le type d'exercice le plus pertinent ;
- adapte-le au niveau ;
- adapte-le à la matière ;
- varie les situations ;
- donne une consigne claire ;
- ne donne pas immédiatement la solution ;
- attends la réponse de l'élève.

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

Utilise les réponses précédentes pour déterminer si l'élève a besoin :

- de consolidation ;
- d'un petit défi supplémentaire ;
- d'une aide ;
- d'un exercice plus simple.

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