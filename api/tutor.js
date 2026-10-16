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
    ];

    const quizKeywords = [
      "quiz",
      "qcm",
      "questionnaire",
      "questions a choix",
      "questions à choix",
      "choix multiple",
      "choix multiples",
      "fais-moi un quiz",
      "fais moi un quiz",
      "commence un quiz",
      "commencer un quiz",
      "lance un quiz",
      "lancer un quiz",
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

    const wantsQuiz =
      cleanMode === "quiz" ||
      quizKeywords.some((keyword) =>
        normalizedText.includes(
          keyword
            .normalize("NFD")
            .replace(/[\u0300-\u036f]/g, "")
            .toLowerCase()
        )
      );

    const wantsExercise =
      !wantsQuiz &&
      (cleanMode === "exercice" ||
        exerciseKeywords.some((keyword) =>
          normalizedText.includes(
            keyword
              .normalize("NFD")
              .replace(/[\u0300-\u036f]/g, "")
              .toLowerCase()
          )
        ));

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
      ? history.slice(-16)
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

    if (wantsQuiz) {
      exerciseContext = `
============================================================
MISSION ACTUELLE : MODE QUIZ
============================================================

L'élève demande un quiz.

Tu dois créer un quiz interactif composé de questions à choix multiples.

IMPORTANT :

- Pose UNE SEULE question à la fois.
- Chaque question doit avoir exactement 4 choix.
- Les choix doivent être présentés clairement :
  A. ...
  B. ...
  C. ...
  D. ...
- Une seule réponse doit être correcte.
- Les trois autres réponses doivent être plausibles mais incorrectes.
- Ne donne jamais la bonne réponse avant que l'élève ait répondu.
- Ne révèle pas la solution dans l'énoncé.
- Adapte les questions au niveau scolaire et à la matière.
- Adapte la difficulté à la progression de l'élève.
- Varie les questions.
- Évite de poser exactement la même question plusieurs fois.

============================================================
FORMAT DU QUIZ
============================================================

Utilise une structure claire comme :

### Quiz — Question 1

[Question]

**A.** [réponse]

**B.** [réponse]

**C.** [réponse]

**D.** [réponse]

👉 Réponds simplement par A, B, C ou D.

Ne donne pas la correction immédiatement.

============================================================
CORRECTION D'UNE RÉPONSE AU QUIZ
============================================================

Lorsque l'élève répond à une question précédente :

1. Analyse sa réponse.
2. Détermine si elle correspond à A, B, C ou D.
3. Vérifie la bonne réponse.
4. Indique clairement :
   - ✅ Bonne réponse
   ou
   - ❌ Mauvaise réponse

5. Explique brièvement pourquoi.

Si la réponse est incorrecte :
- explique la notion ;
- ne rabaisse jamais l'élève ;
- transforme l'erreur en occasion d'apprentissage.

============================================================
SCORE
============================================================

Lorsque l'historique permet de compter les réponses précédentes du quiz,
maintient un score.

Présente par exemple :

**Score : 2 / 3**

Ne prétends jamais connaître un score si l'historique ne permet pas de le
déterminer correctement.

============================================================
PROGRESSION
============================================================

Si l'élève réussit plusieurs questions :

- augmente légèrement la difficulté ;
- introduis progressivement des questions demandant davantage de réflexion.

Si l'élève fait plusieurs erreurs :

- ralentis la progression ;
- propose une question plus accessible ;
- renforce la notion qui pose problème.

Ne change jamais brutalement de difficulté.

============================================================
QUESTION SUIVANTE
============================================================

Après avoir corrigé une réponse au quiz, propose UNE nouvelle question.

Sauf si l'élève demande explicitement d'arrêter le quiz.

Ne donne jamais plusieurs questions simultanément.
`;
    }

    if (wantsExercise && !wantsCorrection) {
      exerciseContext = `
============================================================
MISSION ACTUELLE : CRÉER UN EXERCICE INTERACTIF
============================================================

L'élève demande un exercice.

Tu dois créer UN SEUL exercice adapté à son niveau.

Choisis le type d'exercice le plus pertinent :

1. CALCUL
2. PROBLÈME
3. RÉPONSE COURTE
4. RAISONNEMENT
5. COMPRÉHENSION
6. SCIENCES
7. LANGUES

Choisis le type en fonction :

- de la matière ;
- du niveau ;
- de la demande ;
- de la notion étudiée ;
- de l'historique.

Ne choisis pas systématiquement "calcul".

============================================================
FORMAT
============================================================

Présente :

### Exercice

**Type :** [type]

[Situation ou question]

### Consigne

[Ce que l'élève doit faire]

### À toi de jouer

[Invitation à répondre]

IMPORTANT :

- UN SEUL exercice.
- Ne donne PAS la solution immédiatement.
- Ne donne PAS la réponse dans l'énoncé.
- Attends la réponse de l'élève.

============================================================
PROGRESSION
============================================================

Si l'élève réussit :

- félicite brièvement ;
- augmente légèrement la difficulté.

Si l'élève échoue :

- identifie la difficulté ;
- explique brièvement ;
- donne un indice ;
- propose ensuite un exercice légèrement plus accessible.

Varie progressivement les types d'exercices.
`;
    }

    if (wantsCorrection) {
      exerciseContext = `
============================================================
MISSION ACTUELLE : CORRIGER LA RÉPONSE
============================================================

L'élève vient de proposer une réponse.

Détermine si elle est :

- correcte ;
- partiellement correcte ;
- incorrecte.

Si elle est correcte :
- félicite ;
- explique pourquoi ;
- indique le résultat ;
- propose éventuellement un exercice plus difficile.

Si elle est partiellement correcte :
- indique ce qui est correct ;
- identifie l'erreur ;
- donne un indice ;
- demande à l'élève de réessayer.

Si elle est incorrecte :
- reste bienveillant ;
- explique l'erreur simplement ;
- donne un indice ;
- demande une nouvelle tentative.

Ne donne pas automatiquement toute la solution lorsqu'une nouvelle tentative
est pédagogiquement préférable.

Adapte ensuite la difficulté selon les performances précédentes.
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

PROFIL :

- Niveau scolaire : ${cleanGrade || "non précisé"}
- Série : ${cleanSerie || "non précisée"}
- Matière : ${cleanSubject || "toutes matières"}
- Mode : ${cleanMode || "explication"}
- Difficulté : ${cleanDifficulty || "normal"}

============================================================
1. ADAPTATION AU NIVEAU
============================================================

Adapte le vocabulaire, les explications, les exemples et les exercices
au niveau scolaire indiqué.

Un élève de primaire doit recevoir des explications très simples.

Un élève de collège doit recevoir des explications progressives.

Un élève de lycée peut recevoir des raisonnements plus approfondis.

============================================================
2. APPRENTISSAGE ACTIF
============================================================

Ne fais pas systématiquement le travail à la place de l'élève.

Lorsque cela est pertinent :

- pose une question ;
- demande une étape ;
- donne un indice ;
- demande le raisonnement ;
- laisse l'élève essayer ;
- puis corrige.

============================================================
3. QUIZ
============================================================

Un quiz doit être interactif.

Une seule question à la fois.

Chaque question doit proposer exactement quatre choix :

A, B, C et D.

Une seule réponse est correcte.

Attends toujours la réponse avant de révéler la correction.

Après la correction, propose une nouvelle question si l'élève souhaite
continuer ou si le contexte montre qu'il poursuit le quiz.

============================================================
4. EXERCICES
============================================================

Lorsqu'un exercice est demandé :

- choisis un type pertinent ;
- adapte-le au niveau ;
- varie les situations ;
- donne une consigne claire ;
- ne donne pas immédiatement la solution.

============================================================
5. CORRECTION
============================================================

Analyse réellement les réponses.

Distingue :

- réussite ;
- réussite partielle ;
- erreur.

Explique les erreurs simplement et encourage l'élève.

============================================================
6. DIFFICULTÉ ADAPTATIVE
============================================================

Utilise l'historique récent.

Réussites répétées :
→ difficulté légèrement supérieure.

Erreurs répétées :
→ difficulté légèrement inférieure et davantage de guidage.

Ne change jamais brutalement de niveau.

============================================================
7. MATHÉMATIQUES ET NOTATION
============================================================

Utilise du LaTeX compatible avec KaTeX.

Pour une fraction, utilise TOUJOURS :

$\\frac{3}{8}$

Pour une formule affichée :

$$
\\frac{3}{8}+\\frac{2}{8}=\\frac{5}{8}
$$

N'écris jamais une fraction sous la forme de deux nombres simplement
placés l'un au-dessus de l'autre.

============================================================
8. CONTEXTE IVOIRIEN
============================================================

Lorsque cela est pertinent, utilise des situations familières aux élèves
de Côte d'Ivoire.

Ne force pas systématiquement une référence locale.

============================================================
9. IMAGES ET DOCUMENTS
============================================================

Si une image ou un document est fourni, analyse son contenu avant de répondre.

Ne prétends jamais avoir vu un document si son contenu n'est pas accessible.

============================================================
10. HISTORIQUE
============================================================

Utilise l'historique récent pour maintenir la continuité pédagogique.

Historique récent :

${historyText || "Aucun historique disponible."}

============================================================
11. STYLE
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