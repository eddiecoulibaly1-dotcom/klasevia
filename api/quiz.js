const MODELS = [
  "gemini-3.6-flash",
  "gemini-3.5-flash-lite"
];

const TOTAL_QUESTIONS = 10;

const QUESTION_SCHEMA = {
  type: "object",
  properties: {
    questionId: {
      type: "string",
      description: "Identifiant unique de la question."
    },
    questionText: {
      type: "string",
      description: "Énoncé clair de la question en français."
    },
    answerType: {
      type: "string",
      enum: ["qcm", "fraction", "number"],
      description:
        "Type de réponse attendu."
    },
    choices: {
      type: "array",
      items: {
        type: "string"
      },
      description:
        "Quatre choix pour un QCM. Tableau vide pour fraction ou nombre."
    },
    correctAnswer: {
      type: "string",
      description:
        "Réponse correcte. QCM=A/B/C/D, fraction=a/b, nombre=valeur numérique."
    },
    explanation: {
      type: "string",
      description:
        "Explication pédagogique courte et exacte."
    },
    difficulty: {
      type: "string",
      enum: ["facile", "normal", "difficile"],
      description: "Difficulté de la question."
    }
  },
  required: [
    "questionId",
    "questionText",
    "answerType",
    "choices",
    "correctAnswer",
    "explanation",
    "difficulty"
  ]
};


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


function fractionsEqual(firstValue, secondValue) {
  const first = parseFraction(firstValue);
  const second = parseFraction(secondValue);

  if (!first || !second) {
    return false;
  }

  return (
    first.numerator === second.numerator &&
    first.denominator === second.denominator
  );
}


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


function numbersEqual(firstValue, secondValue) {
  const first = parseNumber(firstValue);
  const second = parseNumber(secondValue);

  if (
    first === null ||
    second === null
  ) {
    return false;
  }

  return Math.abs(first - second) < 0.000001;
}


function normalizeChoice(value) {
  const text = normalizeText(value);

  const match = text.match(
    /^([abcd])(?:[\.\)\-:]|\s|$)/
  );

  return match
    ? match[1].toUpperCase()
    : "";
}


/* =========================================================
   VALIDATION DES QUESTIONS
   ========================================================= */

function validateQuestion(question) {
  if (!question) {
    throw new Error(
      "La question générée est vide."
    );
  }

  if (
    typeof question.questionId !== "string" ||
    !question.questionId.trim()
  ) {
    throw new Error(
      "Identifiant de question invalide."
    );
  }

  if (
    typeof question.questionText !== "string" ||
    !question.questionText.trim()
  ) {
    throw new Error(
      "Énoncé de question invalide."
    );
  }

  if (
    ![
      "qcm",
      "fraction",
      "number"
    ].includes(question.answerType)
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
      "Réponse correcte absente."
    );
  }

  if (
    typeof question.explanation !== "string" ||
    !question.explanation.trim()
  ) {
    throw new Error(
      "Explication absente."
    );
  }

  if (
    ![
      "facile",
      "normal",
      "difficile"
    ].includes(question.difficulty)
  ) {
    question.difficulty = "normal";
  }

  if (
    question.answerType === "qcm"
  ) {
    if (
      !Array.isArray(question.choices) ||
      question.choices.length !== 4
    ) {
      throw new Error(
        "Un QCM doit contenir exactement quatre choix."
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
        "Un choix du QCM est vide."
      );
    }

    const correctChoice =
      normalizeChoice(
        question.correctAnswer
      );

    if (
      !["A", "B", "C", "D"].includes(
        correctChoice
      )
    ) {
      throw new Error(
        "La réponse correcte du QCM doit être A, B, C ou D."
      );
    }

    question.correctAnswer =
      correctChoice;
  }

  if (
    question.answerType === "fraction"
  ) {
    if (
      !parseFraction(
        question.correctAnswer
      )
    ) {
      throw new Error(
        "La fraction correcte est invalide."
      );
    }

    question.choices = [];
  }

  if (
    question.answerType === "number"
  ) {
    if (
      parseNumber(
        question.correctAnswer
      ) === null
    ) {
      throw new Error(
        "La réponse numérique est invalide."
      );
    }

    question.choices = [];
  }

  return question;
}


/* =========================================================
   APPEL GEMINI
   ========================================================= */

function isRetryableStatus(status) {
  return [
    429,
    500,
    502,
    503,
    504
  ].includes(status);
}


function sleep(milliseconds) {
  return new Promise(resolve => {
    setTimeout(resolve, milliseconds);
  });
}


async function callOneGeminiModel({
  apiKey,
  model,
  prompt
}) {
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
          responseMimeType:
            "application/json",

          responseSchema:
            QUESTION_SCHEMA,

          maxOutputTokens: 2000
        }
      })
    });

  const rawText =
    await response.text();

  if (!response.ok) {
    const error =
      new Error(
        `Gemini ${model} HTTP ${response.status}`
      );

    error.status =
      response.status;

    error.details =
      rawText.slice(0, 1000);

    throw error;
  }

  let data;

  try {
    data = JSON.parse(rawText);
  } catch {
    throw new Error(
      `Gemini ${model} a renvoyé une réponse non JSON.`
    );
  }

  const text =
    data?.candidates?.[0]
      ?.content?.parts
      ?.map(
        part => part?.text || ""
      )
      .join("")
      .trim();

  if (!text) {
    throw new Error(
      `Gemini ${model} n'a généré aucun contenu exploitable.`
    );
  }

  let parsed;

  try {
    parsed = JSON.parse(text);
  } catch {
    console.error(
      `JSON invalide retourné par ${model}:`,
      text
    );

    throw new Error(
      `Gemini ${model} a produit un JSON invalide.`
    );
  }

  return validateQuestion(
    parsed
  );
}


async function callGeminiWithFallback({
  apiKey,
  prompt
}) {
  let lastError = null;

  for (
    let modelIndex = 0;
    modelIndex < MODELS.length;
    modelIndex++
  ) {
    const model =
      MODELS[modelIndex];

    for (
      let attempt = 1;
      attempt <= 2;
      attempt++
    ) {
      try {
        console.log(
          `Quiz Gemini: ${model}, tentative ${attempt}`
        );

        return await callOneGeminiModel({
          apiKey,
          model,
          prompt
        });
      } catch (error) {
        lastError = error;

        console.error(
          `Échec ${model}, tentative ${attempt}:`,
          error?.message,
          error?.details || ""
        );

        const retryable =
          isRetryableStatus(
            error?.status
          );

        if (
          !retryable &&
          attempt === 1
        ) {
          break;
        }

        if (attempt < 2) {
          await sleep(
            700 * attempt
          );
        }
      }
    }
  }

  throw (
    lastError ||
    new Error(
      "Les modèles Gemini sont indisponibles."
    )
  );
}


/* =========================================================
   GÉNÉRATION GEMINI
   ========================================================= */

async function generateQuestionWithGemini({
  apiKey,
  grade,
  subject,
  serie,
  topic,
  difficulty,
  questionNumber,
  score,
  askedQuestions
}) {
  const previous =
    Array.isArray(askedQuestions) &&
    askedQuestions.length
      ? askedQuestions
          .slice(-8)
          .map(
            (item, index) =>
              `${index + 1}. ${item}`
          )
          .join("\n")
      : "Aucune.";

  const isMath =
    normalizeText(subject)
      .includes("math");

  const isFraction =
    normalizeText(topic)
      .includes("fraction");

  const prompt = `
Tu es le moteur de quiz de Klasévia.

NIVEAU : ${grade || "Non précisé"}
MATIÈRE : ${subject || "Non précisée"}
SÉRIE : ${serie || "Non précisée"}
THÈME : ${topic || subject || "Non précisé"}
DIFFICULTÉ : ${difficulty || "normal"}
NUMÉRO : ${questionNumber}
SCORE : ${score}

Génère UNE SEULE question.

RÈGLES :

- Français clair adapté à l'élève.
- Une seule réponse correcte.
- Aucun énoncé ambigu.
- Ne répète aucune question précédente.
- Vérifie réellement la réponse avant de la fournir.
- L'explication doit être mathématiquement ou pédagogiquement exacte.
- Ne mets aucune réponse dans l'énoncé.
- Retourne uniquement l'objet JSON demandé.

TYPES :

1. qcm
Quatre choix exactement.
correctAnswer = A, B, C ou D.

2. fraction
L'élève écrit une fraction.
Exemple : 3/4.
Les fractions équivalentes doivent être acceptées.

3. number
L'élève écrit un nombre.

RÈGLES MATHÉMATIQUES :

- Vérifie tous les calculs.
- Ne permute jamais numérateur et dénominateur.
- Si le thème concerne les fractions, privilégie answerType="fraction".
- N'utilise pas LaTeX.
- Écris les fractions sous la forme 3/4.

${
  isMath && isFraction
    ? `
Le quiz porte spécifiquement sur les fractions.
Privilégie donc des questions simples et parfaitement vérifiables
sur les fractions, adaptées au niveau ${grade}.
`
    : ""
}

QUESTIONS DÉJÀ POSÉES :

${previous}
`;

  return callGeminiWithFallback({
    apiKey,
    prompt
  });
}


/* =========================================================
   MOTEUR LOCAL DE SECOURS POUR LES FRACTIONS
   ========================================================= */

/*
 * Ce moteur est volontairement indépendant de Gemini.
 *
 * Son rôle :
 * si Gemini 3.6 et Gemini 3.5 sont momentanément indisponibles,
 * un quiz de fractions peut quand même continuer.
 */

const LOCAL_FRACTION_QUESTIONS = [
  {
    questionId: "local-fraction-1",
    questionText:
      "Une tablette de chocolat est divisée en 8 parts égales. Awa mange 3 parts. Quelle fraction de la tablette a-t-elle mangée ?",
    answerType: "fraction",
    choices: [],
    correctAnswer: "3/8",
    explanation:
      "La tablette est divisée en 8 parts égales et Awa en mange 3. La fraction est donc 3/8.",
    difficulty: "facile"
  },

  {
    questionId: "local-fraction-2",
    questionText:
      "Un gâteau est partagé en 6 parts égales. Koffi mange 2 parts. Quelle fraction du gâteau reste-t-il ?",
    answerType: "fraction",
    choices: [],
    correctAnswer: "4/6",
    explanation:
      "Il y a 6 parts au départ et 2 sont mangées. Il reste 6 - 2 = 4 parts, soit 4/6.",
    difficulty: "facile"
  },

  {
    questionId: "local-fraction-3",
    questionText:
      "Une orange est divisée en 10 parts égales. Awa mange 4 parts. Quelle fraction de l'orange a-t-elle mangée ?",
    answerType: "fraction",
    choices: [],
    correctAnswer: "4/10",
    explanation:
      "L'orange possède 10 parts égales et 4 sont mangées. La fraction est donc 4/10, soit 2/5 après simplification.",
    difficulty: "facile"
  },

  {
    questionId: "local-fraction-4",
    questionText:
      "Un pain est partagé en 12 morceaux égaux. Kouassi en donne 5 à son frère. Quelle fraction du pain a-t-il donnée ?",
    answerType: "fraction",
    choices: [],
    correctAnswer: "5/12",
    explanation:
      "Le pain comporte 12 morceaux égaux et 5 sont donnés. La fraction donnée est donc 5/12.",
    difficulty: "facile"
  },

  {
    questionId: "local-fraction-5",
    questionText:
      "Un pain est partagé en 5 parts égales. Abou en donne 3 à sa petite sœur. Quelle fraction du pain a-t-il gardée ?",
    answerType: "fraction",
    choices: [],
    correctAnswer: "2/5",
    explanation:
      "Le pain compte 5 parts. Abou en donne 3, donc il lui reste 5 - 3 = 2 parts. Il garde donc 2/5.",
    difficulty: "facile"
  },

  {
    questionId: "local-fraction-6",
    questionText:
      "Une bouteille contient 8 portions égales. Mariam en utilise 6. Quelle fraction de la bouteille reste-t-il ?",
    answerType: "fraction",
    choices: [],
    correctAnswer: "2/8",
    explanation:
      "Il reste 8 - 6 = 2 portions sur les 8 initiales. La fraction restante est donc 2/8, soit 1/4 après simplification.",
    difficulty: "normal"
  },

  {
    questionId: "local-fraction-7",
    questionText:
      "Une classe compte 20 élèves. 5 élèves portent un tee-shirt blanc. Quelle fraction de la classe portent un tee-shirt blanc ?",
    answerType: "fraction",
    choices: [],
    correctAnswer: "5/20",
    explanation:
      "5 élèves sur 20 portent un tee-shirt blanc. La fraction est donc 5/20, soit 1/4 après simplification.",
    difficulty: "normal"
  },

  {
    questionId: "local-fraction-8",
    questionText:
      "Un terrain est partagé en 9 parcelles égales. 7 parcelles sont utilisées. Quelle fraction du terrain n'est pas utilisée ?",
    answerType: "fraction",
    choices: [],
    correctAnswer: "2/9",
    explanation:
      "Sur 9 parcelles, 7 sont utilisées. Il en reste 9 - 7 = 2. La fraction non utilisée est donc 2/9.",
    difficulty: "normal"
  },

  {
    questionId: "local-fraction-9",
    questionText:
      "Une mangue est découpée en 12 morceaux égaux. Yao mange 8 morceaux. Quelle fraction de la mangue a-t-il mangée ?",
    answerType: "fraction",
    choices: [],
    correctAnswer: "8/12",
    explanation:
      "Yao mange 8 morceaux sur 12. La fraction est donc 8/12, soit 2/3 après simplification.",
    difficulty: "normal"
  },

  {
    questionId: "local-fraction-10",
    questionText:
      "Un sac contient 15 billes identiques. 6 billes sont rouges. Quelle fraction des billes sont rouges ?",
    answerType: "fraction",
    choices: [],
    correctAnswer: "6/15",
    explanation:
      "Il y a 6 billes rouges sur 15. La fraction est donc 6/15, soit 2/5 après simplification.",
    difficulty: "normal"
  }
];


function getLocalFractionQuestion(
  askedQuestions
) {
  const used =
    Array.isArray(askedQuestions)
      ? askedQuestions
      : [];

  const available =
    LOCAL_FRACTION_QUESTIONS.filter(
      question =>
        !used.includes(
          question.questionText
        )
    );

  if (available.length > 0) {
    return available[0];
  }

  return (
    LOCAL_FRACTION_QUESTIONS[
      Math.floor(
        Math.random() *
          LOCAL_FRACTION_QUESTIONS.length
      )
    ]
  );
}


/* =========================================================
   CHOIX DU MOTEUR DE QUESTION
   ========================================================= */

function shouldUseLocalFractionFallback({
  subject,
  topic
}) {
  const math =
    normalizeText(subject)
      .includes("math");

  const fraction =
    normalizeText(topic)
      .includes("fraction");

  return math && fraction;
}


async function generateQuestion({
  apiKey,
  grade,
  subject,
  serie,
  topic,
  difficulty,
  questionNumber,
  score,
  askedQuestions
}) {
  try {
    return await generateQuestionWithGemini({
      apiKey,
      grade,
      subject,
      serie,
      topic,
      difficulty,
      questionNumber,
      score,
      askedQuestions
    });
  } catch (error) {
    console.error(
      "Gemini indisponible pour le quiz :",
      error?.message
    );

    if (
      shouldUseLocalFractionFallback({
        subject,
        topic
      })
    ) {
      console.log(
        "Utilisation du moteur local de secours pour les fractions."
      );

      return getLocalFractionQuestion(
        askedQuestions
      );
    }

    throw error;
  }
}


/* =========================================================
   AFFICHAGE
   ========================================================= */

function formatFraction(value) {
  const fraction =
    parseFraction(value);

  if (!fraction) {
    return String(value);
  }

  return `${fraction.numerator}/${fraction.denominator}`;
}


function formatQuestion(
  question,
  questionNumber
) {
  let output =
    `## 🎯 Question ${questionNumber}/${TOTAL_QUESTIONS}\n\n`;

  output +=
    `${question.questionText}\n\n`;

  if (
    question.answerType === "qcm"
  ) {
    question.choices.forEach(
      (choice, index) => {
        const letter =
          String.fromCharCode(
            65 + index
          );

        output +=
          `${letter}. ${choice}\n`;
      }
    );

    output +=
      "\n✍️ Écris simplement A, B, C ou D.";
  }

  if (
    question.answerType === "fraction"
  ) {
    output +=
      "\n✍️ Écris ta réponse sous forme de fraction, par exemple 3/4.";
  }

  if (
    question.answerType === "number"
  ) {
    output +=
      "\n✍️ Écris simplement le nombre demandé.";
  }

  return output;
}


function getDisplayedCorrectAnswer(
  question
) {
  if (
    question.answerType === "qcm"
  ) {
    const index =
      "ABCD".indexOf(
        question.correctAnswer
      );

    if (
      index >= 0 &&
      question.choices?.[index]
    ) {
      return `${question.correctAnswer}. ${question.choices[index]}`;
    }

    return question.correctAnswer;
  }

  if (
    question.answerType === "fraction"
  ) {
    return formatFraction(
      question.correctAnswer
    );
  }

  return question.correctAnswer;
}


function formatCorrection({
  question,
  studentAnswer,
  isCorrect,
  scoreAfter,
  questionNumber
}) {
  let output = "";

  if (isCorrect) {
    output =
      "### ✅ Bonne réponse !\n\n";
  } else {
    output =
      "### ❌ Ce n'est pas la bonne réponse.\n\n";
  }

  output +=
    `**Ta réponse :** ${studentAnswer}\n\n`;

  output +=
    `**Bonne réponse :** ${getDisplayedCorrectAnswer(
      question
    )}\n\n`;

  output +=
    `${question.explanation}\n\n`;

  output +=
    `**Score actuel : ${scoreAfter}/${questionNumber}**`;

  return output;
}


/* =========================================================
   CORRECTION DÉTERMINISTE
   ========================================================= */

function gradeAnswer(
  question,
  studentAnswer
) {
  const answer =
    String(studentAnswer || "")
      .trim();

  if (!answer) {
    return false;
  }

  if (
    question.answerType === "qcm"
  ) {
    return (
      normalizeChoice(answer) ===
      question.correctAnswer
    );
  }

  if (
    question.answerType === "fraction"
  ) {
    return fractionsEqual(
      answer,
      question.correctAnswer
    );
  }

  if (
    question.answerType === "number"
  ) {
    return numbersEqual(
      answer,
      question.correctAnswer
    );
  }

  return (
    normalizeText(answer) ===
    normalizeText(
      question.correctAnswer
    )
  );
}


/* =========================================================
   DIFFICULTÉ ADAPTATIVE
   ========================================================= */

function getNextDifficulty({
  currentDifficulty,
  isCorrect,
  score,
  answeredQuestions
}) {
  const current =
    currentDifficulty ||
    "normal";

  const ratio =
    answeredQuestions > 0
      ? score / answeredQuestions
      : 0;

  if (
    isCorrect &&
    ratio >= 0.8
  ) {
    if (
      current === "facile"
    ) {
      return "normal";
    }

    if (
      current === "normal"
    ) {
      return "difficile";
    }
  }

  if (
    !isCorrect &&
    ratio < 0.4
  ) {
    if (
      current === "difficile"
    ) {
      return "normal";
    }

    if (
      current === "normal"
    ) {
      return "facile";
    }
  }

  return current;
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

  if (match?.[1]) {
    return match[1]
      .replace(/[.!?]+$/, "")
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
   ÉTAT DU QUIZ
   ========================================================= */

function createQuizState({
  topic,
  question,
  questionNumber,
  score,
  askedQuestions,
  difficulty
}) {
  return {
    active: true,

    total: TOTAL_QUESTIONS,

    totalQuestions:
      TOTAL_QUESTIONS,

    questionNumber,

    score,

    topic:
      topic || "Quiz scolaire",

    difficulty:
      difficulty || "normal",

    askedQuestions:
      Array.isArray(
        askedQuestions
      )
        ? askedQuestions
        : [],

    currentQuestion: {
      questionId:
        question.questionId,

      questionText:
        question.questionText,

      answerType:
        question.answerType,

      choices:
        question.choices || [],

      correctAnswer:
        question.correctAnswer,

      explanation:
        question.explanation,

      difficulty:
        question.difficulty,

      questionNumber
    }
  };
}


/* =========================================================
   RÉPONSE JSON SÉCURISÉE
   ========================================================= */

function sendJson(
  res,
  status,
  payload
) {
  res
    .status(status)
    .setHeader(
      "Content-Type",
      "application/json; charset=utf-8"
    )
    .json(payload);
}


/* =========================================================
   HANDLER PRINCIPAL
   ========================================================= */

export default async function handler(
  req,
  res
) {
  if (req.method !== "POST") {
    return sendJson(
      res,
      405,
      {
        error:
          "Méthode non autorisée."
      }
    );
  }

  try {
    const body =
      req.body || {};

    const action =
      body.action || "";

    const message =
      String(
        body.message || ""
      ).trim();

    const grade =
      body.grade || "";

    const subject =
      body.subject || "";

    const serie =
      body.serie || "";

    const difficulty =
      body.difficulty || "";

    const quizState =
      body.quizState || null;

    const apiKey =
      process.env.GEMINI_API_KEY;

    if (!apiKey) {
      return sendJson(
        res,
        500,
        {
          error:
            "La clé GEMINI_API_KEY n'est pas configurée sur Vercel."
        }
      );
    }


    /* =====================================================
       DÉMARRAGE
       ===================================================== */

    if (
      action === "start"
    ) {
      const topic =
        extractTopic(message) ||
        subject ||
        "Quiz scolaire";

      let initialDifficulty =
        "normal";

      if (
        difficulty === "simple"
      ) {
        initialDifficulty =
          "facile";
      }

      if (
        difficulty === "détaillé"
      ) {
        initialDifficulty =
          "normal";
      }

      const question =
        await generateQuestion({
          apiKey,
          grade,
          subject,
          serie,
          topic,
          difficulty:
            initialDifficulty,
          questionNumber: 1,
          score: 0,
          askedQuestions: []
        });

      const state =
        createQuizState({
          topic,
          question,
          questionNumber: 1,
          score: 0,
          askedQuestions: [
            question.questionText
          ],
          difficulty:
            initialDifficulty
        });

      return sendJson(
        res,
        200,
        {
          answer:
            `🎯 **Quiz Klasévia — ${topic}**\n\n` +
            formatQuestion(
              question,
              1
            ),

          quizState: state
        }
      );
    }


    /* =====================================================
       RÉPONSE
       ===================================================== */

    if (
      action === "answer"
    ) {
      if (
        !quizState ||
        !quizState.active ||
        !quizState.currentQuestion
      ) {
        return sendJson(
          res,
          400,
          {
            error:
              "Aucun quiz actif. Demande un nouveau quiz pour commencer."
          }
        );
      }

      const question =
        quizState.currentQuestion;

      const questionNumber =
        Number(
          quizState.questionNumber ||
            1
        );

      const previousScore =
        Number(
          quizState.score || 0
        );

      const isCorrect =
        gradeAnswer(
          question,
          message
        );

      const newScore =
        previousScore +
        (isCorrect ? 1 : 0);


      /* =================================================
         FIN DU QUIZ
         ================================================= */

      if (
        questionNumber >=
        TOTAL_QUESTIONS
      ) {
        const percentage =
          Math.round(
            (newScore /
              TOTAL_QUESTIONS) *
              100
          );

        let encouragement =
          "";

        if (
          percentage >= 80
        ) {
          encouragement =
            "Excellent travail ! Tu maîtrises très bien cette notion. 🎉";
        } else if (
          percentage >= 60
        ) {
          encouragement =
            "Bon travail ! Quelques révisions supplémentaires te permettront encore de progresser.";
        } else {
          encouragement =
            "Ce n'est pas grave. Nous allons reprendre les notions difficiles étape par étape.";
        }

        const finalMessage =
          formatCorrection({
            question,
            studentAnswer:
              message,
            isCorrect,
            scoreAfter:
              newScore,
            questionNumber
          }) +
          "\n\n---\n\n" +
          "## 🏁 Quiz terminé !\n\n" +
          `**Résultat : ${newScore}/${TOTAL_QUESTIONS} (${percentage} %).**\n\n` +
          encouragement;

        const finalState = {
          ...quizState,

          active: false,

          total:
            TOTAL_QUESTIONS,

          totalQuestions:
            TOTAL_QUESTIONS,

          questionNumber,

          score:
            newScore,

          currentQuestion:
            null,

          finalScore:
            newScore,

          completedAt:
            new Date().toISOString