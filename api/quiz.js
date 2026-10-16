const MODEL = "gemini-3.8-flash";
const TOTAL_QUESTIONS = 10;

function gcd(a, b) {
  let x = Math.abs(a);
  let y = Math.abs(b);

  while (y !== 0) {
    const temp = x % y;
    x = y;
    y = temp;
  }

  return x || 1;
}

function parseFraction(value) {
  const text = String(value || "")
    .trim()
    .replace(/\s+/g, "");

  const match = text.match(/^([+-]?\d+)\/([+-]?\d+)$/);

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

  if (denominator < 0) {
    numerator = -numerator;
    denominator = -denominator;
  }

  const divisor = gcd(numerator, denominator);

  return {
    numerator: numerator / divisor,
    denominator: denominator / divisor
  };
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

function normalizeChoice(value) {
  const text = String(value || "")
    .trim()
    .toUpperCase();

  const match = text.match(/^([ABCD])(?:[\s.)].*)?$/);

  return match ? match[1] : null;
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

  return Number.isFinite(number) ? number : null;
}

function numbersEqual(first, second) {
  const a = parseNumber(first);
  const b = parseNumber(second);

  if (a === null || b === null) {
    return false;
  }

  const tolerance =
    1e-9 * Math.max(
      1,
      Math.abs(a),
      Math.abs(b)
    );

  return Math.abs(a - b) <= tolerance;
}

function gradeAnswer(question, userAnswer) {
  if (!question || !userAnswer) {
    return false;
  }

  if (question.answerType === "qcm") {
    return (
      normalizeChoice(userAnswer) ===
      normalizeChoice(question.correctAnswer)
    );
  }

  if (question.answerType === "fraction") {
    return fractionsEqual(
      userAnswer,
      question.correctAnswer
    );
  }

  if (question.answerType === "number") {
    return numbersEqual(
      userAnswer,
      question.correctAnswer
    );
  }

  return false;
}

function normalizeDifficulty(value) {
  const text = String(value || "")
    .trim()
    .toLowerCase();

  if (text === "simple") {
    return "facile";
  }

  if (
    text === "détaillé" ||
    text === "detaille"
  ) {
    return "normal";
  }

  if (text === "facile") {
    return "facile";
  }

  if (text === "difficile") {
    return "difficile";
  }

  return "normal";
}

function calculateNextDifficulty(
  currentScore,
  answeredCount,
  requestedDifficulty
) {
  if (answeredCount <= 1) {
    return normalizeDifficulty(
      requestedDifficulty
    );
  }

  const ratio =
    currentScore / answeredCount;

  if (ratio >= 0.8) {
    return "difficile";
  }

  if (ratio < 0.4) {
    return "facile";
  }

  return "normal";
}

function cleanQuestion(question) {
  if (
    !question ||
    typeof question !== "object"
  ) {
    return null;
  }

  return {
    questionId: String(
      question.questionId || ""
    ).trim(),

    questionText: String(
      question.questionText || ""
    ).trim(),

    answerType: String(
      question.answerType || ""
    ).trim(),

    choices: Array.isArray(
      question.choices
    )
      ? question.choices
          .map((choice) =>
            String(
              choice || ""
            ).trim()
          )
          .filter(Boolean)
      : [],

    correctAnswer: String(
      question.correctAnswer || ""
    ).trim(),

    explanation: String(
      question.explanation || ""
    ).trim(),

    difficulty: String(
      question.difficulty ||
        "normal"
    ).trim()
  };
}

function validateQuestion(question) {
  const cleaned =
    cleanQuestion(question);

  if (!cleaned) {
    return {
      valid: false,
      question: null
    };
  }

  if (!cleaned.questionId) {
    return {
      valid: false,
      question: null
    };
  }

  if (!cleaned.questionText) {
    return {
      valid: false,
      question: null
    };
  }

  if (
    ![
      "qcm",
      "fraction",
      "number"
    ].includes(
      cleaned.answerType
    )
  ) {
    return {
      valid: false,
      question: null
    };
  }

  if (!cleaned.explanation) {
    return {
      valid: false,
      question: null
    };
  }

  if (
    ![
      "facile",
      "normal",
      "difficile"
    ].includes(
      cleaned.difficulty
    )
  ) {
    cleaned.difficulty =
      "normal";
  }

  if (
    cleaned.answerType ===
    "qcm"
  ) {
    if (
      cleaned.choices.length !==
      4
    ) {
      return {
        valid: false,
        question: null
      };
    }

    const correctChoice =
      normalizeChoice(
        cleaned.correctAnswer
      );

    if (!correctChoice) {
      return {
        valid: false,
        question: null
      };
    }

    cleaned.correctAnswer =
      correctChoice;
  }

  if (
    cleaned.answerType ===
    "fraction"
  ) {
    if (
      !parseFraction(
        cleaned.correctAnswer
      )
    ) {
      return {
        valid: false,
        question: null
      };
    }

    cleaned.choices = [];
  }

  if (
    cleaned.answerType ===
    "number"
  ) {
    if (
      parseNumber(
        cleaned.correctAnswer
      ) === null
    ) {
      return {
        valid: false,
        question: null
      };
    }

    cleaned.choices = [];
  }

  return {
    valid: true,
    question: cleaned
  };
}

function extractText(data) {
  const parts =
    data?.candidates?.[0]
      ?.content?.parts || [];

  return parts
    .map(
      (part) =>
        part?.text || ""
    )
    .join("")
    .trim();
}

function extractJson(text) {
  if (!text) {
    return null;
  }

  let cleaned = String(text)
    .trim();

  cleaned = cleaned
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();

  try {
    return JSON.parse(cleaned);
  } catch (error) {
    const firstBrace =
      cleaned.indexOf("{");

    const lastBrace =
      cleaned.lastIndexOf("}");

    if (
      firstBrace !== -1 &&
      lastBrace !== -1 &&
      lastBrace > firstBrace
    ) {
      const possibleJson =
        cleaned.slice(
          firstBrace,
          lastBrace + 1
        );

      try {
        return JSON.parse(
          possibleJson
        );
      } catch (secondError) {
        return null;
      }
    }

    return null;
  }
}

async function generateQuestion({
  apiKey,
  grade,
  serie,
  subject,
  topic,
  difficulty,
  askedQuestions
}) {
  const url =
    "https://generativelanguage.googleapis.com/v1beta/models/" +
    MODEL +
    ":generateContent";

  const previousQuestions =
    Array.isArray(
      askedQuestions
    ) &&
    askedQuestions.length > 0
      ? askedQuestions
          .slice(-15)
          .map(
            (question, index) =>
              `${index + 1}. ${question}`
          )
          .join("\n")
      : "Aucune question précédente.";

  const prompt = `
Tu es le moteur de quiz de Klasévia.

Klasévia est une plateforme éducative destinée principalement aux élèves de Côte d'Ivoire.

Génère UNE SEULE question de quiz.

NIVEAU :
${grade || "Non précisé"}

SÉRIE :
${serie || "Non précisée"}

MATIÈRE :
${subject || "Non précisée"}

THÈME :
${topic || "Non précisé"}

DIFFICULTÉ :
${difficulty || "normal"}

QUESTIONS DÉJÀ POSÉES :
${previousQuestions}

RÈGLES PÉDAGOGIQUES :

- Adapte la question au niveau scolaire.
- Reste strictement sur le thème demandé.
- Ne répète aucune question précédente.
- Utilise un français clair.
- Le contexte ivoirien peut être utilisé lorsque c'est naturel.
- Génère exactement UNE question.
- Ne donne pas la réponse dans le texte de la question.
- Ne mets aucun Markdown.
- N'utilise aucun LaTeX.

TYPES AUTORISÉS :

1. qcm
Pour les matières générales ou lorsque le QCM est pertinent.
Il faut exactement 4 choix.
correctAnswer doit être A, B, C ou D.

2. fraction
À utiliser pour les questions portant sur les fractions.
correctAnswer doit être une fraction simple comme :
3/4
5/8
7/10

3. number
À utiliser pour une réponse numérique.
correctAnswer doit être un nombre simple.

RÈGLE TRÈS IMPORTANTE POUR LES MATHÉMATIQUES :

Effectue réellement le calcul avant de donner correctAnswer.

Vérifie le résultat une deuxième fois.

Exemple :
6/10 = 3/5.
Il ne faut surtout pas répondre 5/3.

FORMAT OBLIGATOIRE :

Tu dois répondre UNIQUEMENT avec un objet JSON valide ayant exactement cette structure :

{
  "questionId": "identifiant unique",
  "questionText": "texte de la question",
  "answerType": "qcm",
  "choices": ["choix A", "choix B", "choix C", "choix D"],
  "correctAnswer": "A",
  "explanation": "courte explication pédagogique",
  "difficulty": "normal"
}

Pour une question de fraction :

{
  "questionId": "identifiant unique",
  "questionText": "texte de la question",
  "answerType": "fraction",
  "choices": [],
  "correctAnswer": "3/5",
  "explanation": "courte explication pédagogique",
  "difficulty": "normal"
}

Pour une question numérique :

{
  "questionId": "identifiant unique",
  "questionText": "texte de la question",
  "answerType": "number",
  "choices": [],
  "correctAnswer": "12",
  "explanation": "courte explication pédagogique",
  "difficulty": "normal"
}

Ne mets aucun texte avant ou après le JSON.
`;

  const body = {
    contents: [
      {
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

      thinkingConfig: {
        thinkingLevel:
          "medium"
      },

      maxOutputTokens: 2048
    }
  };

  let lastError =
    "La génération de la question a échoué.";

  for (
    let attempt = 0;
    attempt < 2;
    attempt += 1
  ) {
    try {
      const response =
        await fetch(url, {
          method: "POST",

          headers: {
            "Content-Type":
              "application/json",

            "x-goog-api-key":
              apiKey
          },

          body:
            JSON.stringify(body)
        });

      const data =
        await response.json();

      if (!response.ok) {
        lastError =
          data?.error?.message ||
          `Gemini a retourné une erreur HTTP ${response.status}.`;

        continue;
      }

      const text =
        extractText(data);

      if (!text) {
        lastError =
          "Gemini n'a fourni aucun texte pour la question.";

        continue;
      }

      const parsed =
        extractJson(text);

      if (!parsed) {
        lastError =
          "Gemini a fourni une réponse qui n'est pas un JSON valide.";

        continue;
      }

      const validation =
        validateQuestion(
          parsed
        );

      if (!validation.valid) {
        lastError =
          "La question générée n'a pas le format attendu.";

        continue;
      }

      return validation.question;
    } catch (error) {
      lastError =
        error?.message ||
        "Erreur réseau pendant la génération du quiz.";
    }
  }

  throw new Error(
    lastError
  );
}

function displayCorrectAnswer(
  question
) {
  if (
    question.answerType ===
    "qcm"
  ) {
    const choice =
      normalizeChoice(
        question.correctAnswer
      );

    const index = {
      A: 0,
      B: 1,
      C: 2,
      D: 3
    }[choice];

    if (
      index !== undefined &&
      question.choices[index]
    ) {
      return (
        `${choice}. ` +
        question.choices[index]
      );
    }

    return (
      choice ||
      question.correctAnswer
    );
  }

  return question.correctAnswer;
}

function formatQuestion(
  question,
  questionNumber,
  total
) {
  let text =
    `🎯 Question ${questionNumber}/${total}\n\n` +
    question.questionText;

  if (
    question.answerType ===
    "qcm"
  ) {
    text +=
      "\n\n" +
      `A. ${question.choices[0]}\n` +
      `B. ${question.choices[1]}\n` +
      `C. ${question.choices[2]}\n` +
      `D. ${question.choices[3]}` +
      "\n\n" +
      "Réponds simplement par A, B, C ou D.";
  }

  if (
    question.answerType ===
    "fraction"
  ) {
    text +=
      "\n\n" +
      "Écris ta réponse sous forme de fraction, par exemple 3/4.";
  }

  if (
    question.answerType ===
    "number"
  ) {
    text +=
      "\n\n" +
      "Écris uniquement ta réponse numérique.";
  }

  return text;
}

function formatAnswerResult({
  question,
  userAnswer,
  isCorrect,
  newScore,
  answeredNumber
}) {
  let text = "";

  if (isCorrect) {
    text +=
      "✅ Bonne réponse !\n\n" +
      `Ta réponse : ${userAnswer}\n\n`;

    if (
      question.explanation
    ) {
      text +=
        question.explanation +
        "\n";
    }
  } else {
    text +=
      "❌ Ce n'est pas la bonne réponse.\n\n" +
      `Ta réponse : ${userAnswer}\n` +
      `Bonne réponse : ${displayCorrectAnswer(question)}\n\n`;

    if (
      question.explanation
    ) {
      text +=
        question.explanation +
        "\n";
    }
  }

  text +=
    `\n📊 Score actuel : ${newScore}/${answeredNumber}`;

  return text;
}

function sanitizeQuizState(
  state
) {
  if (
    !state ||
    typeof state !==
      "object"
  ) {
    return null;
  }

  if (!state.active) {
    return null;
  }

  if (
    !state.currentQuestion
  ) {
    return null;
  }

  const validation =
    validateQuestion(
      state.currentQuestion
    );

  if (!validation.valid) {
    return null;
  }

  const total =
    Number.isInteger(
      state.total
    ) &&
    state.total > 0
      ? state.total
      : TOTAL_QUESTIONS;

  const questionNumber =
    Number.isInteger(
      state.questionNumber
    ) &&
    state.questionNumber > 0
      ? state.questionNumber
      : 1;

  const score =
    Number.isInteger(
      state.score
    ) &&
    state.score >= 0
      ? state.score
      : 0;

  const askedQuestions =
    Array.isArray(
      state.askedQuestions
    )
      ? state.askedQuestions
          .map((question) =>
            String(
              question || ""
            ).trim()
          )
          .filter(Boolean)
      : [];

  return {
    active: true,

    total,

    questionNumber,

    score,

    topic: String(
      state.topic || ""
    ).trim(),

    currentQuestion:
      validation.question,

    askedQuestions,

    startedAt:
      state.startedAt ||
      new Date().toISOString()
  };
}

async function handleStart({
  apiKey,
  message,
  grade,
  serie,
  subject,
  difficulty
}) {
  const topic =
    String(
      message || ""
    ).trim();

  if (!topic) {
    throw new Error(
      "Le thème du quiz est vide."
    );
  }

  const question =
    await generateQuestion({
      apiKey,
      grade,
      serie,
      subject,
      topic,
      difficulty:
        normalizeDifficulty(
          difficulty
        ),
      askedQuestions: []
    });

  const quizState = {
    active: true,

    total:
      TOTAL_QUESTIONS,

    questionNumber: 1,

    score: 0,

    topic,

    currentQuestion:
      question,

    askedQuestions: [
      question.questionText
    ],

    startedAt:
      new Date().toISOString()
  };

  return {
    message:
      "🎯 Quiz lancé !\n\n" +
      formatQuestion(
        question,
        1,
        TOTAL_QUESTIONS
      ),

    quizState
  };
}

async function handleAnswer({
  apiKey,
  message,
  grade,
  serie,
  subject,
  difficulty,
  quizState
}) {
  const state =
    sanitizeQuizState(
      quizState
    );

  if (!state) {
    throw new Error(
      "Le quiz n'est plus actif. Demande-moi de lancer un nouveau quiz."
    );
  }

  const userAnswer =
    String(
      message || ""
    ).trim();

  if (!userAnswer) {
    throw new Error(
      "Aucune réponse n'a été saisie."
    );
  }

  const currentQuestion =
    state.currentQuestion;

  const isCorrect =
    gradeAnswer(
      currentQuestion,
      userAnswer
    );

  const answeredNumber =
    state.questionNumber;

  const newScore =
    state.score +
    (isCorrect ? 1 : 0);

  let resultText =
    formatAnswerResult({
      question:
        currentQuestion,

      userAnswer,

      isCorrect,

      newScore,

      answeredNumber
    });

  if (
    answeredNumber >=
    state.total
  ) {
    resultText +=
      "\n\n🏁 Quiz terminé !\n\n" +
      `Score final : ${newScore}/${state.total}`;

    if (
      newScore ===
      state.total
    ) {
      resultText +=
        "\n🌟 Excellent ! Toutes les réponses sont correctes.";
    } else if (
      newScore >=
      Math.ceil(
        state.total * 0.8
      )
    ) {
      resultText +=
        "\n👏 Très bon travail !";
    } else if (
      newScore >=
      Math.ceil(
        state.total * 0.5
      )
    ) {
      resultText +=
        "\n💪 Bon travail. Continue à t'entraîner !";
    } else {
      resultText +=
        "\n📚 Il faut encore t'entraîner. Tu vas progresser !";
    }

    return {
      message:
        resultText,

      quizState: {
        ...state,

        active: false,

        questionNumber:
          answeredNumber,

        score:
          newScore,

        currentQuestion:
          null,

        finishedAt:
          new Date().toISOString()
      }
    };
  }

  const nextQuestionNumber =
    answeredNumber + 1;

  const nextDifficulty =
    calculateNextDifficulty(
      newScore,
      answeredNumber,
      difficulty
    );

  const nextQuestion =
    await generateQuestion({
      apiKey,
      grade,
      serie,
      subject,
      topic:
        state.topic,

      difficulty:
        nextDifficulty,

      askedQuestions:
        state.askedQuestions
    });

  const updatedAskedQuestions =
    [
      ...state.askedQuestions,
      nextQuestion.questionText
    ].slice(-20);

  const updatedState = {
    ...state,

    active: true,

    questionNumber:
      nextQuestionNumber,

    score:
      newScore,

    currentQuestion:
      nextQuestion,

    askedQuestions:
      updatedAskedQuestions
  };

  resultText +=
    "\n\n" +
    formatQuestion(
      nextQuestion,
      nextQuestionNumber,
      state.total
    );

  return {
    message:
      resultText,

    quizState:
      updatedState
  };
}

export default async function handler(
  req,
  res
) {
  if (
    req.method !== "POST"
  ) {
    return res.status(405).json({
      message:
        "Méthode non autorisée.",
      error:
        "Méthode non autorisée."
    });
  }

  try {
    const apiKey =
      process.env.GEMINI_API_KEY;

    if (!apiKey) {
      return res.status(500).json({
        message:
          "La clé GEMINI_API_KEY est absente de la configuration Vercel.",
        error:
          "GEMINI_API_KEY missing"
      });
    }

    const body =
      req.body || {};

    const action =
      body.action;

    const message =
      body.message;

    const grade =
      body.grade;

    const serie =
      body.serie;

    const subject =
      body.subject;

    const difficulty =
      body.difficulty;

    const quizState =
      body.quizState;

    if (
      action !== "start" &&
      action !== "answer"
    ) {
      return res.status(400).json({
        message:
          "Action de quiz invalide.",
        error:
          "L'action doit être start ou answer."
      });
    }

    if (
      action === "start"
    ) {
      const result =
        await handleStart({
          apiKey,
          message,
          grade,
          serie,
          subject,
          difficulty
        });

      if (
        !result ||
        !result.message
      ) {
        throw new Error(
          "Le moteur de quiz n'a généré aucune réponse."
        );
      }

      return res.status(200).json({
        message:
          result.message,

        quizState:
          result.quizState
      });
    }

    const result =
      await handleAnswer({
        apiKey,
        message,
        grade,
        serie,
        subject,
        difficulty,
        quizState
      });

    if (
      !result ||
      !result.message
    ) {
      throw new Error(
        "Le moteur de quiz n'a généré aucune réponse."
      );
    }

    return res.status(200).json({
      message:
        result.message,

      quizState:
        result.quizState
    });
  } catch (error) {
    console.error(
      "Erreur API quiz:",
      error
    );

    const errorMessage =
      error?.message ||
      "Une erreur est survenue pendant le quiz.";

    return res.status(500).json({
      message:
        `❌ Le quiz n'a pas pu démarrer correctement.\n\n${errorMessage}`,

      error:
        errorMessage
    });
  }
}