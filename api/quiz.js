const TOTAL_QUESTIONS = 10;

// Gemini reste disponible pour les quiz ouverts.
// Mais le quiz de fractions ne dépend plus de Gemini.
const GEMINI_MODELS = [
  "gemini-3.6-flash",
  "gemini-3.8-flash",
  "gemini-3.5-flash-lite"
];

const QUESTION_SCHEMA = {
  type: "object",
  properties: {
    questionId: {
      type: "string"
    },
    questionText: {
      type: "string"
    },
    answerType: {
      type: "string",
      enum: ["qcm", "fraction", "number"]
    },
    choices: {
      type: "array",
      items: {
        type: "string"
      }
    },
    correctAnswer: {
      type: "string"
    },
    explanation: {
      type: "string"
    },
    difficulty: {
      type: "string",
      enum: ["facile", "normal", "difficile"]
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

function sendJson(res, status, data) {
  return res.status(status).json(data);
}

/* =========================================================
   OUTILS MATHÉMATIQUES
   ========================================================= */

function gcd(a, b) {
  a = Math.abs(a);
  b = Math.abs(b);

  while (b !== 0) {
    const temp = b;
    b = a % b;
    a = temp;
  }

  return a || 1;
}

function simplifyFraction(numerator, denominator) {
  if (denominator === 0) {
    throw new Error("Dénominateur nul.");
  }

  if (denominator < 0) {
    numerator *= -1;
    denominator *= -1;
  }

  const divisor = gcd(numerator, denominator);

  return {
    numerator: numerator / divisor,
    denominator: denominator / divisor
  };
}

function fractionString(numerator, denominator) {
  const simplified = simplifyFraction(
    numerator,
    denominator
  );

  return `${simplified.numerator}/${simplified.denominator}`;
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

  let numerator = Number(match[1]);
  let denominator = Number(match[2]);

  if (
    !Number.isFinite(numerator) ||
    !Number.isFinite(denominator) ||
    denominator === 0
  ) {
    return null;
  }

  return simplifyFraction(
    numerator,
    denominator
  );
}

function fractionsEqual(first, second) {
  const a = parseFraction(first);
  const b = parseFraction(second);

  if (!a || !b) {
    return false;
  }

  return (
    a.numerator === b.numerator &&
    a.denominator === b.denominator
  );
}

function parseNumber(value) {
  const text = String(value || "")
    .trim()
    .replace(/\s+/g, "")
    .replace(",", ".")
    .replace(/[^0-9eE+.-]/g, "");

  if (!text) {
    return null;
  }

  const number = Number(text);

  return Number.isFinite(number)
    ? number
    : null;
}

function normalizeChoice(value) {
  const text = String(value || "")
    .trim()
    .toUpperCase();

  if (/^[ABCD]$/.test(text)) {
    return text;
  }

  const match = text.match(
    /^(?:RÉPONSE|REPONSE|CHOIX)?\s*([ABCD])(?:[.)\s].*)?$/
  );

  return match ? match[1] : null;
}

/* =========================================================
   CORRECTION DÉTERMINISTE
   ========================================================= */

function gradeAnswer(question, userAnswer) {
  if (!question || !userAnswer) {
    return false;
  }

  if (question.answerType === "fraction") {
    return fractionsEqual(
      userAnswer,
      question.correctAnswer
    );
  }

  if (question.answerType === "number") {
    const a = parseNumber(userAnswer);
    const b = parseNumber(
      question.correctAnswer
    );

    if (a === null || b === null) {
      return false;
    }

    return (
      Math.abs(a - b) <=
      1e-9 * Math.max(1, Math.abs(b))
    );
  }

  if (question.answerType === "qcm") {
    return (
      normalizeChoice(userAnswer) ===
      normalizeChoice(
        question.correctAnswer
      )
    );
  }

  return false;
}

/* =========================================================
   IDENTIFICATION DU TYPE DE QUIZ
   ========================================================= */

function isFractionQuiz({
  message,
  subject
}) {
  const text = `
    ${message || ""}
    ${subject || ""}
  `
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");

  const math =
    text.includes("math") ||
    text.includes("mathematique");

  const fraction =
    text.includes("fraction");

  return math && fraction;
}

/* =========================================================
   MOTEUR LOCAL : FRACTIONS
   ========================================================= */

function createLocalFractionQuestion(
  questionNumber
) {
  const questions = {
    1: {
      questionId: "fractions-local-1",
      questionText:
        "Une classe compte 20 élèves. Les 3/5 des élèves participent à un concours. Combien d'élèves participent au concours ?",
      answerType: "number",
      choices: [],
      correctAnswer: "12",
      explanation:
        "Calcul : 20 × 3/5 = 60/5 = 12. Donc 12 élèves participent au concours.",
      difficulty: "facile"
    },

    2: {
      questionId: "fractions-local-2",
      questionText:
        "Une tablette est divisée en 8 morceaux égaux. Awa mange 3 morceaux. Quelle fraction de la tablette reste-t-il ?",
      answerType: "fraction",
      choices: [],
      correctAnswer: "5/8",
      explanation:
        "Il reste 8 − 3 = 5 morceaux sur 8. La fraction restante est donc 5/8.",
      difficulty: "facile"
    },

    3: {
      questionId: "fractions-local-3",
      questionText:
        "Simplifie la fraction 12/18.",
      answerType: "fraction",
      choices: [],
      correctAnswer: "2/3",
      explanation:
        "12 et 18 sont divisibles par 6. Donc 12/18 = 2/3.",
      difficulty: "normal"
    },

    4: {
      questionId: "fractions-local-4",
      questionText:
        "Quelle fraction est équivalente à 3/4 ?",
      answerType: "qcm",
      choices: [
        "4/6",
        "6/8",
        "8/12",
        "9/16"
      ],
      correctAnswer: "B",
      explanation:
        "3/4 × 2/2 = 6/8. La réponse B est donc correcte.",
      difficulty: "normal"
    },

    5: {
      questionId: "fractions-local-5",
      questionText:
        "Laquelle de ces fractions est la plus grande : 5/8 ou 3/4 ?",
      answerType: "qcm",
      choices: [
        "5/8 est plus grande",
        "Elles sont égales",
        "3/4 est plus grande",
        "On ne peut pas comparer"
      ],
      correctAnswer: "C",
      explanation:
        "3/4 = 6/8. Comme 6/8 est supérieur à 5/8, 3/4 est la plus grande.",
      difficulty: "normal"
    },

    6: {
      questionId: "fractions-local-6",
      questionText:
        "Calcule 2/7 + 3/7.",
      answerType: "fraction",
      choices: [],
      correctAnswer: "5/7",
      explanation:
        "Les dénominateurs sont identiques. On additionne les numérateurs : 2 + 3 = 5. Donc 5/7.",
      difficulty: "normal"
    },

    7: {
      questionId: "fractions-local-7",
      questionText:
        "Calcule 6/9 − 2/9 et donne le résultat sous forme simplifiée.",
      answerType: "fraction",
      choices: [],
      correctAnswer: "4/9",
      explanation:
        "6/9 − 2/9 = 4/9. La fraction 4/9 est déjà simplifiée.",
      difficulty: "normal"
    },

    8: {
      questionId: "fractions-local-8",
      questionText:
        "Calcule les 3/4 de 28.",
      answerType: "number",
      choices: [],
      correctAnswer: "21",
      explanation:
        "28 × 3/4 = 84/4 = 21.",
      difficulty: "normal"
    },

    9: {
      questionId: "fractions-local-9",
      questionText:
        "Quelle est la plus grande fraction parmi les quatre suivantes ?",
      answerType: "qcm",
      choices: [
        "2/3",
        "3/5",
        "5/8",
        "7/12"
      ],
      correctAnswer: "A",
      explanation:
        "2/3 est environ égal à 0,667. Les autres fractions sont plus petites. La réponse A est donc correcte.",
      difficulty: "difficile"
    },

    10: {
      questionId: "fractions-local-10",
      questionText:
        "Une bouteille contient 2 litres de jus. On boit les 3/8 du contenu. Quelle fraction du jus reste-t-il ?",
      answerType: "fraction",
      choices: [],
      correctAnswer: "5/8",
      explanation:
        "La totalité correspond à 8/8. Après avoir bu 3/8, il reste 8/8 − 3/8 = 5/8.",
      difficulty: "difficile"
    }
  };

  return (
    questions[questionNumber] ||
    questions[1]
  );
}

/* =========================================================
   AFFICHAGE D'UNE QUESTION
   ========================================================= */

function formatQuestion(
  question,
  number,
  total
) {
  let text =
    `🎯 **Question ${number}/${total}**\n\n`;

  text += `${question.questionText}\n\n`;

  if (question.answerType === "qcm") {
    text += `**A.** ${question.choices[0]}\n`;
    text += `**B.** ${question.choices[1]}\n`;
    text += `**C.** ${question.choices[2]}\n`;
    text += `**D.** ${question.choices[3]}\n\n`;
    text +=
      `👉 Réponds simplement par **A, B, C ou D**.`;
  } else if (
    question.answerType === "fraction"
  ) {
    text +=
      `👉 Écris ta réponse sous forme de fraction, par exemple **3/4**.`;
  } else {
    text +=
      `👉 Écris simplement la valeur numérique.`;
  }

  return text;
}

function correctAnswerDisplay(question) {
  if (question.answerType === "qcm") {
    const letter = normalizeChoice(
      question.correctAnswer
    );

    const index = [
      "A",
      "B",
      "C",
      "D"
    ].indexOf(letter);

    if (
      index >= 0 &&
      question.choices[index]
    ) {
      return `${letter}. ${question.choices[index]}`;
    }

    return letter;
  }

  return question.correctAnswer;
}

/* =========================================================
   VALIDATION
   ========================================================= */

function validateQuestion(question) {
  if (!question) {
    return false;
  }

  if (
    typeof question.questionText !==
      "string" ||
    !question.questionText.trim()
  ) {
    return false;
  }

  if (
    ![
      "qcm",
      "fraction",
      "number"
    ].includes(question.answerType)
  ) {
    return false;
  }

  if (!Array.isArray(question.choices)) {
    return false;
  }

  if (
    typeof question.correctAnswer !==
      "string" ||
    !question.correctAnswer.trim()
  ) {
    return false;
  }

  if (
    typeof question.explanation !==
      "string"
  ) {
    return false;
  }

  if (question.answerType === "qcm") {
    if (question.choices.length !== 4) {
      return false;
    }

    if (
      !normalizeChoice(
        question.correctAnswer
      )
    ) {
      return false;
    }
  }

  if (question.answerType === "fraction") {
    if (
      !parseFraction(
        question.correctAnswer
      )
    ) {
      return false;
    }
  }

  if (question.answerType === "number") {
    if (
      parseNumber(
        question.correctAnswer
      ) === null
    ) {
      return false;
    }
  }

  return true;
}

/* =========================================================
   GEMINI
   ========================================================= */

function sleep(ms) {
  return new Promise((resolve) =>
    setTimeout(resolve, ms)
  );
}

function isRetryableStatus(status) {
  return (
    status === 408 ||
    status === 429 ||
    status >= 500
  );
}

async function callGeminiModel({
  apiKey,
  model,
  prompt
}) {
  const response = await fetch(
    "https://generativelanguage.googleapis.com/v1beta/interactions",
    {
      method: "POST",
      headers: {
        "Content-Type":
          "application/json",
        "x-goog-api-key": apiKey
      },
      body: JSON.stringify({
        model,
        input: prompt,

        response_format: {
          type: "text",
          mime_type:
            "application/json",
          schema:
            QUESTION_SCHEMA
        },

        generation_config: {
          max_output_tokens: 1200,
          thinking_level: "low"
        }
      })
    }
  );

  const raw = await response.text();

  let data = null;

  try {
    data = JSON.parse(raw);
  } catch {
    data = null;
  }

  if (!response.ok) {
    const message =
      data?.error?.message ||
      data?.message ||
      raw ||
      "Erreur Gemini inconnue.";

    const error = new Error(
      `Gemini ${response.status}: ${message}`
    );

    error.status = response.status;

    throw error;
  }

  const outputText =
    typeof data?.output_text ===
    "string"
      ? data.output_text.trim()
      : "";

  if (!outputText) {
    throw new Error(
      "Gemini n'a fourni aucun contenu."
    );
  }

  let question;

  try {
    question =
      JSON.parse(outputText);
  } catch {
    throw new Error(
      "Gemini a fourni un JSON invalide."
    );
  }

  if (!validateQuestion(question)) {
    throw new Error(
      "La question Gemini est invalide."
    );
  }

  return question;
}

async function generateGeminiQuestion({
  apiKey,
  grade,
  serie,
  subject,
  difficulty,
  topic,
  askedQuestions
}) {
  const previous =
    Array.isArray(askedQuestions)
      ? askedQuestions
          .slice(-10)
          .join("\n- ")
      : "";

  const prompt = `
Tu es le moteur de quiz de Klasévia.

Génère UNE nouvelle question de quiz.

Niveau : ${grade || "non précisé"}
Série : ${serie || "non précisée"}
Matière : ${subject || "non précisée"}
Sujet : ${topic || "non précisé"}
Difficulté : ${difficulty || "normal"}

La question doit être adaptée au niveau de l'élève.

Si une réponse numérique ou une fraction est parfaitement adaptée,
utilise answerType "number" ou "fraction".

Pour une question ambiguë, utilise plutôt un QCM avec exactement
quatre choix A, B, C et D.

Pour une fraction :
- correctAnswer doit être une fraction exacte comme 3/4.
- vérifie le calcul avant de répondre.
- accepte les fractions équivalentes lors de la correction côté application.

Ne répète aucune question précédente.

Questions déjà posées :
- ${previous || "aucune"}

Ne mets pas la réponse dans questionText.

Retourne uniquement le JSON demandé.
`;

  let lastError = null;

  for (
    let modelIndex = 0;
    modelIndex <
    GEMINI_MODELS.length;
    modelIndex += 1
  ) {
    const model =
      GEMINI_MODELS[modelIndex];

    for (
      let attempt = 0;
      attempt < 2;
      attempt += 1
    ) {
      try {
        return await callGeminiModel({
          apiKey,
          model,
          prompt
        });
      } catch (error) {
        lastError = error;

        if (
          !isRetryableStatus(
            error?.status
          )
        ) {
          throw error;
        }

        if (attempt === 0) {
          await sleep(
            1000 +
              Math.floor(
                Math.random() * 700
              )
          );
        }
      }
    }
  }

  throw (
    lastError ||
    new Error(
      "Tous les modèles Gemini sont temporairement indisponibles."
    )
  );
}

/* =========================================================
   ÉTAT DU QUIZ
   ========================================================= */

function validQuizState(state) {
  return (
    state &&
    state.active === true &&
    Number.isInteger(
      state.questionNumber
    ) &&
    state.questionNumber >= 1 &&
    Number.isInteger(state.total) &&
    state.total === TOTAL_QUESTIONS &&
    Number.isInteger(state.score) &&
    state.score >= 0 &&
    state.currentQuestion &&
    validateQuestion(
      state.currentQuestion
    )
  );
}

/* =========================================================
   DÉMARRAGE
   ========================================================= */

async function startQuiz({
  apiKey,
  message,
  grade,
  serie,
  subject,
  difficulty
}) {
  const localFraction =
    isFractionQuiz({
      message,
      subject
    });

  let question;
  let engine;

  if (localFraction) {
    question =
      createLocalFractionQuestion(1);

    engine = "local";
  } else {
    question =
      await generateGeminiQuestion({
        apiKey,
        grade,
        serie,
        subject,
        difficulty,
        topic: message,
        askedQuestions: []
      });

    engine = "gemini";
  }

  const quizState = {
    active: true,
    total: TOTAL_QUESTIONS,
    questionNumber: 1,
    score: 0,

    topic: message,
    grade: grade || "",
    serie: serie || "",
    subject: subject || "",

    engine,

    currentQuestion: question,

    askedQuestions: [
      question.questionText
    ],

    startedAt:
      new Date().toISOString()
  };

  let intro =
    `🎯 **Quiz Klasévia**\n\n`;

  intro +=
    `Matière : **${
      subject || "non précisée"
    }**\n`;

  intro +=
    `Niveau : **${
      grade || "non précisé"
    }**\n\n`;

  intro +=
    `Le quiz comporte **${TOTAL_QUESTIONS} questions**.\n`;

  if (engine === "local") {
    intro +=
      `\n🧮 Ce quiz utilise le moteur mathématique de Klasévia pour garantir une correction exacte.\n`;
  }

  intro +=
    `\n` +
    formatQuestion(
      question,
      1,
      TOTAL_QUESTIONS
    );

  return {
    message: intro,
    quizState
  };
}

/* =========================================================
   RÉPONSE
   ========================================================= */

async function answerQuiz({
  apiKey,
  message,
  quizState,
  grade,
  serie,
  subject,
  difficulty
}) {
  if (!validQuizState(quizState)) {
    throw new Error(
      "Le quiz actif est invalide. Redémarre un nouveau quiz."
    );
  }

  const userAnswer =
    String(message || "").trim();

  if (!userAnswer) {
    throw new Error(
      "Aucune réponse n'a été reçue du quiz."
    );
  }

  const question =
    quizState.currentQuestion;

  const correct =
    gradeAnswer(
      question,
      userAnswer
    );

  const newScore =
    quizState.score +
    (correct ? 1 : 0);

  let correction = "";

  if (correct) {
    correction +=
      `✅ **Bonne réponse !**\n\n`;

    correction +=
      `Ta réponse : **${userAnswer}**\n\n`;

    correction +=
      question.explanation;
  } else {
    correction +=
      `❌ **Ce n'est pas la bonne réponse.**\n\n`;

    correction +=
      `Ta réponse : **${userAnswer}**\n\n`;

    correction +=
      `Bonne réponse : **${correctAnswerDisplay(
        question
      )}**\n\n`;

    correction +=
      question.explanation;
  }

  if (
    quizState.questionNumber >=
    TOTAL_QUESTIONS
  ) {
    const finalState = {
      ...quizState,

      active: false,

      score: newScore,

      currentQuestion: null,

      finishedAt:
        new Date().toISOString()
    };

    let result =
      `\n\n---\n\n🏁 **Quiz terminé !**\n\n`;

    result +=
      `### Score : ${newScore}/${TOTAL_QUESTIONS}\n\n`;

    if (
      newScore === TOTAL_QUESTIONS
    ) {
      result +=
        "🌟 Excellent ! Toutes les réponses sont correctes.";
    } else if (newScore >= 8) {
      result +=
        "👏 Très bon travail !";
    } else if (newScore >= 5) {
      result +=
        "👍 Bon travail. Continue à t'entraîner !";
    } else {
      result +=
        "💪 Continue tes efforts. Tu vas progresser !";
    }

    return {
      message:
        correction + result,
      quizState: finalState
    };
  }

  const nextNumber =
    quizState.questionNumber + 1;

  let nextQuestion;
  let engine =
    quizState.engine || "gemini";

  if (engine === "local") {
    nextQuestion =
      createLocalFractionQuestion(
        nextNumber
      );
  } else {
    nextQuestion =
      await generateGeminiQuestion({
        apiKey,
        grade:
          quizState.grade || grade,
        serie:
          quizState.serie || serie,
        subject:
          quizState.subject || subject,
        difficulty,
        topic:
          quizState.topic,
        askedQuestions:
          quizState.askedQuestions
      });
  }

  const askedQuestions = [
    ...(Array.isArray(
      quizState.askedQuestions
    )
      ? quizState.askedQuestions
      : []),
    nextQuestion.questionText
  ].slice(-20);

  const nextState = {
    ...quizState,

    active: true,

    questionNumber: nextNumber,

    score: newScore,

    currentQuestion:
      nextQuestion,

    askedQuestions
  };

  const nextMessage =
    correction +
    `\n\n---\n\n` +
    formatQuestion(
      nextQuestion,
      nextNumber,
      TOTAL_QUESTIONS
    );

  return {
    message: nextMessage,
    quizState: nextState
  };
}

/* =========================================================
   HANDLER VERCEL
   ========================================================= */

export default async function handler(
  req,
  res
) {
  if (req.method !== "POST") {
    return sendJson(res, 405, {
      ok: false,
      error:
        "Méthode non autorisée."
    });
  }

  try {
    const body =
      req.body &&
      typeof req.body === "object"
        ? req.body
        : {};

    const action =
      String(
        body.action || ""
      )
        .trim()
        .toLowerCase();

    const message =
      String(
        body.message || ""
      ).trim();

    const grade =
      String(
        body.grade || ""
      ).trim();

    const serie =
      String(
        body.serie || ""
      ).trim();

    const subject =
      String(
        body.subject || ""
      ).trim();

    const difficulty =
      String(
        body.difficulty || ""
      ).trim();

    const quizState =
      body.quizState || null;

    const apiKey =
      process.env.GEMINI_API_KEY || "";

    /*
     * IMPORTANT :
     * Les quiz de fractions locaux ne nécessitent
     * aucune clé Gemini.
     */
    if (
      action === "start" &&
      isFractionQuiz({
        message,
        subject
      })
    ) {
      const result =
        await startQuiz({
          apiKey,
          message,
          grade,
          serie,
          subject,
          difficulty
        });

      return sendJson(res, 200, {
        ok: true,
        message:
          result.message,
        quizState:
          result.quizState
      });
    }

    /*
     * Les autres quiz utilisent Gemini.
     */
    if (!apiKey) {
      return sendJson(res, 500, {
        ok: false,
        error:
          "La variable GEMINI_API_KEY est absente de Vercel."
      });
    }

    if (!message) {
      return sendJson(res, 400, {
        ok: false,
        error:
          "Le message est vide."
      });
    }

    if (action === "start") {
      const result =
        await startQuiz({
          apiKey,
          message,
          grade,
          serie,
          subject,
          difficulty
        });

      return sendJson(res, 200, {
        ok: true,
        message:
          result.message,
        quizState:
          result.quizState
      });
    }

    if (action === "answer") {
      const result =
        await answerQuiz({
          apiKey,
          message,
          quizState,
          grade,
          serie,
          subject,
          difficulty
        });

      return sendJson(res, 200, {
        ok: true,
        message:
          result.message,
        quizState:
          result.quizState
      });
    }

    return sendJson(res, 400, {
      ok: false,
      error:
        "Action inconnue. Utilise start ou answer."
    });
  } catch (error) {
    console.error(
      "Klasévia quiz error:",
      error
    );

    const status =
      Number.isInteger(
        error?.status
      )
        ? error.status
        : 500;

    /*
     * Ne renvoie plus un message incompréhensible
     * comme "Aucune réponse n'a été reçue"
     * lorsqu'il s'agit en réalité d'une panne Gemini.
     */
    if (
      status === 503 ||
      status === 429
    ) {
      return sendJson(res, 503, {
        ok: false,
        error:
          "Le service IA est temporairement très sollicité. Le quiz peut être relancé dans quelques instants.",
        code:
          status === 503
            ? "GEMINI_UNAVAILABLE"
            : "GEMINI_RATE_LIMIT"
      });
    }

    return sendJson(res, 500, {
      ok: false,
      error:
        error?.message ||
        "Une erreur est survenue dans le moteur du quiz."
    });
  }
}