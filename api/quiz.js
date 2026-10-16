const PRIMARY_MODEL = "gemini-3.6-flash";
const FALLBACK_MODEL = "gemini-3.5-flash-lite";

const TOTAL_QUESTIONS = 10;

const MAX_GENERATION_ATTEMPTS = 3;

/* =========================================================
   OUTILS GÉNÉRAUX
========================================================= */

function normalizeText(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

/* =========================================================
   FRACTIONS
========================================================= */

function gcd(a, b) {
  let x = Math.abs(a);
  let y = Math.abs(b);

  while (y !== 0) {
    const r = x % y;
    x = y;
    y = r;
  }

  return x || 1;
}

function parseFraction(value) {
  const text = String(value || "")
    .trim()
    .replace(/\s+/g, "");

  const match = text.match(
    /^([+-]?\d+)\/([+-]?\d+)$/
  );

  if (!match) {
    return null;
  }

  const numerator = Number(match[1]);
  const denominator = Number(match[2]);

  if (
    !Number.isFinite(numerator) ||
    !Number.isFinite(denominator) ||
    denominator === 0
  ) {
    return null;
  }

  let n = numerator;
  let d = denominator;

  if (d < 0) {
    n = -n;
    d = -d;
  }

  const divisor = gcd(n, d);

  return {
    numerator: n / divisor,
    denominator: d / divisor
  };
}

function fractionsEqual(a, b) {
  const first = parseFraction(a);
  const second = parseFraction(b);

  if (!first || !second) {
    return false;
  }

  return (
    first.numerator === second.numerator &&
    first.denominator === second.denominator
  );
}

function formatFraction(value) {
  const fraction = parseFraction(value);

  if (!fraction) {
    return String(value || "");
  }

  return `${fraction.numerator}/${fraction.denominator}`;
}

/* =========================================================
   NOMBRES
========================================================= */

function parseNumber(value) {
  const text = String(value || "")
    .trim()
    .replace(/\s+/g, "")
    .replace(",", ".");

  if (!text) {
    return null;
  }

  const number = Number(text);

  return Number.isFinite(number)
    ? number
    : null;
}

function numbersEqual(a, b) {
  const first = parseNumber(a);
  const second = parseNumber(b);

  if (first === null || second === null) {
    return false;
  }

  return (
    Math.abs(first - second) <=
    0.000001
  );
}

/* =========================================================
   QCM
========================================================= */

function normalizeChoice(value) {
  const text = normalizeText(value);

  const match = text.match(
    /^([abcd])(?:[\.\)\-:]|$)/
  );

  return match
    ? match[1].toUpperCase()
    : "";
}

/* =========================================================
   VALIDATION D'UNE QUESTION
========================================================= */

function validateQuestion(question) {
  if (!question || typeof question !== "object") {
    throw new Error(
      "Une question générée est invalide."
    );
  }

  if (
    typeof question.questionId !== "string" ||
    !question.questionId.trim()
  ) {
    throw new Error(
      "Identifiant de question manquant."
    );
  }

  if (
    typeof question.questionText !== "string" ||
    !question.questionText.trim()
  ) {
    throw new Error(
      "Énoncé de question manquant."
    );
  }

  if (
    !["qcm", "fraction", "number"].includes(
      question.answerType
    )
  ) {
    throw new Error(
      "Type de réponse invalide."
    );
  }

  if (
    typeof question.correctAnswer !== "string" ||
    !question.correctAnswer.trim()
  ) {
    throw new Error(
      "Réponse correcte manquante."
    );
  }

  if (
    typeof question.explanation !== "string" ||
    !question.explanation.trim()
  ) {
    throw new Error(
      "Explication manquante."
    );
  }

  if (
    !["facile", "normal", "difficile"].includes(
      question.difficulty
    )
  ) {
    question.difficulty = "normal";
  }

  if (!Array.isArray(question.choices)) {
    question.choices = [];
  }

  /* ---------- QCM ---------- */

  if (question.answerType === "qcm") {
    if (question.choices.length !== 4) {
      throw new Error(
        "Un QCM doit avoir exactement quatre choix."
      );
    }

    question.choices = question.choices.map(
      choice => String(choice || "").trim()
    );

    if (
      question.choices.some(
        choice => !choice
      )
    ) {
      throw new Error(
        "Un choix de QCM est vide."
      );
    }

    const correct =
      normalizeChoice(
        question.correctAnswer
      );

    if (
      !["A", "B", "C", "D"].includes(
        correct
      )
    ) {
      throw new Error(
        "Réponse QCM invalide."
      );
    }

    question.correctAnswer = correct;
  }

  /* ---------- FRACTION ---------- */

  if (
    question.answerType === "fraction"
  ) {
    question.choices = [];

    if (
      !parseFraction(
        question.correctAnswer
      )
    ) {
      throw new Error(
        "Fraction correcte invalide."
      );
    }

    question.correctAnswer =
      formatFraction(
        question.correctAnswer
      );
  }

  /* ---------- NOMBRE ---------- */

  if (
    question.answerType === "number"
  ) {
    question.choices = [];

    if (
      parseNumber(
        question.correctAnswer
      ) === null
    ) {
      throw new Error(
        "Réponse numérique invalide."
      );
    }

    question.correctAnswer =
      String(
        question.correctAnswer
      ).trim();
  }

  return question;
}

/* =========================================================
   EXTRACTION DU JSON
========================================================= */

function extractJson(text) {
  let cleaned = String(text || "")
    .trim();

  /*
   * Gemini peut parfois entourer le JSON
   * de ```json ... ```
   */
  cleaned = cleaned
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();

  /*
   * Recherche d'un tableau JSON si Gemini
   * ajoute accidentellement du texte avant/après.
   */
  const firstBracket =
    cleaned.indexOf("[");

  const lastBracket =
    cleaned.lastIndexOf("]");

  if (
    firstBracket >= 0 &&
    lastBracket > firstBracket
  ) {
    cleaned = cleaned.slice(
      firstBracket,
      lastBracket + 1
    );
  }

  try {
    return JSON.parse(cleaned);
  } catch (error) {
    console.error(
      "JSON Gemini Quiz impossible à analyser :",
      cleaned
    );

    throw new Error(
      "Gemini a produit un quiz qui n'est pas exploitable."
    );
  }
}

/* =========================================================
   APPEL GEMINI
========================================================= */

async function callGemini(
  apiKey,
  model,
  prompt
) {
  const url =
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(
      apiKey
    )}`;

  const response =
    await fetch(url, {
      method: "POST",

      headers: {
        "Content-Type":
          "application/json"
      },

      body: JSON.stringify({
        contents: [
          {
            role: "user",

            parts: [
              {
                text: prompt
              }
            ]
          }
        ],

        generationConfig: {
          maxOutputTokens: 12000
        }
      })
    });

  const rawText =
    await response.text();

  if (!response.ok) {
    console.error(
      `Gemini ${model} HTTP ${response.status}:`,
      rawText
    );

    const error =
      new Error(
        `Gemini ${model} HTTP ${response.status}`
      );

    error.status =
      response.status;

    throw error;
  }

  let data;

  try {
    data =
      JSON.parse(rawText);
  } catch {
    throw new Error(
      "Réponse Gemini illisible."
    );
  }

  const text =
    data?.candidates?.[0]
      ?.content?.parts
      ?.map(
        part =>
          part?.text || ""
      )
      .join("")
      .trim();

  if (!text) {
    throw new Error(
      "Gemini n'a fourni aucun contenu exploitable."
    );
  }

  return text;
}

/* =========================================================
   GÉNÉRATION DES 10 QUESTIONS
========================================================= */

async function generateQuiz({
  apiKey,
  grade,
  subject,
  serie,
  topic,
  difficulty
}) {
  const normalizedSubject =
    normalizeText(subject);

  const normalizedTopic =
    normalizeText(topic);

  const isMath =
    normalizedSubject.includes(
      "math"
    );

  const isFraction =
    normalizedTopic.includes(
      "fraction"
    );

  const prompt = `
Tu es le générateur officiel des quiz de Klasévia.

Ta mission est de générer exactement ${TOTAL_QUESTIONS}
questions différentes pour un élève.

INFORMATIONS SCOLAIRES

Niveau : ${grade || "non précisé"}
Matière : ${subject || "non précisée"}
Série : ${serie || "non précisée"}
Thème : ${topic || subject || "non précisé"}
Difficulté de départ : ${
    difficulty || "normal"
  }

CONTEXTE

Klasévia est une plateforme éducative destinée notamment
aux élèves de Côte d'Ivoire.

Les questions doivent être naturelles, pédagogiques,
claires et adaptées au niveau scolaire.

RÈGLES ABSOLUES

1. Génère exactement 10 questions.
2. Les 10 questions doivent être différentes.
3. Elles doivent toutes correspondre au niveau indiqué.
4. Elles doivent toutes correspondre à la matière.
5. Elles doivent toutes correspondre au thème demandé.
6. Chaque question doit avoir UNE réponse déterminée.
7. Aucun énoncé ne doit être ambigu.
8. Vérifie réellement chaque réponse avant de l'envoyer.
9. Les explications doivent être correctes.
10. Ne mets jamais la réponse dans l'énoncé.
11. N'utilise pas de Markdown.
12. N'utilise pas de LaTeX.
13. N'utilise pas de fractions visuelles.
14. Pour les fractions, écris simplement 3/4, 2/5, etc.

TYPES DE RÉPONSES

Pour les mathématiques sur les fractions :
utilise principalement answerType = "fraction".

Pour une question demandant un nombre :
utilise answerType = "number".

Pour les autres matières, utilise principalement
answerType = "qcm".

POUR UN QCM

choices doit contenir exactement quatre chaînes.

Les choix doivent correspondre à :

A = premier choix
B = deuxième choix
C = troisième choix
D = quatrième choix

correctAnswer doit être exactement :
A, B, C ou D.

POUR UNE FRACTION

choices doit être [].

correctAnswer doit être une fraction comme :

3/4

ou

2/5

Vérifie soigneusement numérateur et dénominateur.

EXEMPLE IMPORTANT

Si l'énoncé dit :

"Un gâteau est partagé en 8 parts égales.
On donne 5 parts. Quelle fraction reste-t-il ?"

La bonne réponse est :

3/8

et NON :

5/8

POUR LES MATHÉMATIQUES

Effectue réellement les calculs avant de produire
correctAnswer.

Ne permute jamais numérateur et dénominateur.

Si plusieurs fractions sont équivalentes,
correctAnswer doit contenir une forme simple.

${
  isMath && isFraction
    ? `
CAS PARTICULIER :

Il s'agit d'un quiz de mathématiques sur les fractions
pour le niveau indiqué.

Privilégie des situations simples et progressives :

- part d'un tout ;
- fraction restante ;
- fraction mangée ou donnée ;
- comparaison simple ;
- fractions équivalentes ;
- simplification ;
- addition ou soustraction adaptée au niveau ;
- multiplication ou division seulement si adaptée au niveau.

Utilise answerType = "fraction" lorsque l'élève
doit écrire une fraction.
`
    : ""
}

DIFFICULTÉ

Commence au niveau demandé.

Fais progresser légèrement la difficulté
au fil des questions.

Les questions 1 à 3 doivent être accessibles.

Les questions 4 à 7 doivent être de niveau normal.

Les questions 8 à 10 peuvent être légèrement plus difficiles,
sans dépasser le niveau scolaire demandé.

FORMAT OBLIGATOIRE

Ta réponse doit être UNIQUEMENT un tableau JSON.

Pas de texte avant le tableau.

Pas de texte après le tableau.

Format :

[
  {
    "questionId": "q1",
    "questionText": "...",
    "answerType": "fraction",
    "choices": [],
    "correctAnswer": "3/4",
    "explanation": "...",
    "difficulty": "facile"
  }
]

Puis q2, q3, etc. jusqu'à q10.

IMPORTANT :
Le JSON doit être valide.
Utilise uniquement des guillemets doubles.
`;

  /*
   * Première tentative : Gemini 3.6 Flash.
   * Deuxième possibilité : Gemini 3.5 Flash-Lite.
   */

  const models = [
    PRIMARY_MODEL,
    FALLBACK_MODEL
  ];

  let lastError =
    null;

  for (
    let attempt = 0;
    attempt < MAX_GENERATION_ATTEMPTS;
    attempt++
  ) {
    const model =
      models[
        Math.min(
          attempt,
          models.length - 1
        )
      ];

    try {
      const raw =
        await callGemini(
          apiKey,
          model,
          prompt
        );

      const parsed =
        extractJson(raw);

      if (
        !Array.isArray(parsed)
      ) {
        throw new Error(
          "Gemini n'a pas produit un tableau de questions."
        );
      }

      if (
        parsed.length !==
        TOTAL_QUESTIONS
      ) {
        throw new Error(
          `Gemini a généré ${parsed.length} questions au lieu de ${TOTAL_QUESTIONS}.`
        );
      }

      const questions =
        parsed.map(
          question =>
            validateQuestion(
              question
            )
        );

      /*
       * Vérification supplémentaire :
       * les identifiants doivent être uniques.
       */

      const ids =
        new Set(
          questions.map(
            question =>
              question.questionId
          )
        );

      if (
        ids.size !==
        questions.length
      ) {
        throw new Error(
          "Deux questions possèdent le même identifiant."
        );
      }

      /*
       * Vérification supplémentaire :
       * les énoncés doivent être différents.
       */

      const texts =
        questions.map(
          question =>
            normalizeText(
              question.questionText
            )
        );

      const uniqueTexts =
        new Set(texts);

      if (
        uniqueTexts.size !==
        texts.length
      ) {
        throw new Error(
          "Gemini a généré des questions en double."
        );
      }

      return questions;
    } catch (error) {
      lastError =
        error;

      console.error(
        `Échec génération quiz avec ${model}, tentative ${
          attempt + 1
        }/${MAX_GENERATION_ATTEMPTS}`,
        error
      );

      /*
       * Petit délai avant une nouvelle tentative.
       */

      if (
        attempt <
        MAX_GENERATION_ATTEMPTS - 1
      ) {
        await sleep(
          1200 *
            Math.pow(
              2,
              attempt
            )
        );
      }
    }
  }

  throw (
    lastError ||
    new Error(
      "Impossible de générer le quiz."
    )
  );
}

/* =========================================================
   ATTENTE
========================================================= */

function sleep(ms) {
  return new Promise(
    resolve =>
      setTimeout(
        resolve,
        ms
      )
  );
}

/* =========================================================
   DIFFICULTÉ
========================================================= */

function normalizeDifficulty(
  difficulty
) {
  if (
    difficulty ===
    "simple"
  ) {
    return "facile";
  }

  if (
    difficulty ===
    "détaillé"
  ) {
    return "normal";
  }

  return "normal";
}

/* =========================================================
   EXTRACTION DU THÈME
========================================================= */

function extractTopic(message) {
  const text =
    String(message || "")
      .trim();

  const match =
    text.match(
      /\bsur\s+(.+)$/i
    );

  if (
    match &&
    match[1]
  ) {
    return match[1]
      .replace(
        /[.!?]+$/,
        ""
      )
      .trim();
  }

  const cleaned =
    text
      .replace(
        /fais-moi/gi,
        ""
      )
      .replace(
        /fais moi/gi,
        ""
      )
      .replace(
        /donne-moi/gi,
        ""
      )
      .replace(
        /donne moi/gi,
        ""
      )
      .replace(
        /un quiz/gi,
        ""
      )
      .replace(
        /un qcm/gi,
        ""
      )
      .replace(
        /quiz/gi,
        ""
      )
      .replace(
        /qcm/gi,
        ""
      )
      .trim();

  return cleaned;
}

/* =========================================================
   AFFICHAGE D'UNE QUESTION
========================================================= */

function formatQuestion(
  question,
  questionNumber
) {
  let output =
   