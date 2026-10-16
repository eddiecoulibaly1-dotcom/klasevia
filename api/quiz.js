const MODEL = "gemini-3.8-flash";
const TOTAL_QUESTIONS = 10;

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
    1e-9 * Math.max(1, Math.abs(a), Math.abs(b));

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
    return normalizeDifficulty(requestedDifficulty);
  }

  const ratio = currentScore / answeredCount;

  if (ratio >= 0.8) {
    return "difficile";
  }

  if (ratio < 0.4) {
    return "facile";
  }

  return "normal";
}

function cleanQuestion(question) {
  if (!question || typeof question !== "object") {
    return null;
  }

  const cleaned = {
    questionId: String(question.questionId || "").trim(),
    questionText: String(question.questionText || "").trim(),
    answerType: String(question.answerType || "").trim(),
    choices: Array.isArray(question.choices)
      ? question.choices
          .map((choice) => String(choice || "").trim())
          .filter(Boolean)
      : [],
    correctAnswer: String(
      question.correctAnswer || ""
    ).trim(),
    explanation: String(
      question.explanation || ""
    ).trim(),
    difficulty: String(
      question.difficulty || "normal"
    ).trim()
  };

  return cleaned;
}

function validateQuestion(question) {
  const cleaned = cleanQuestion(question);

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
    !["qcm", "fraction", "number"].includes(
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
    !["facile", "normal", "difficile"].includes(
      cleaned.difficulty
    )
  ) {
    cleaned.difficulty = "normal";
  }

  if (cleaned.answerType === "qcm") {
    if (cleaned.choices.length !== 4) {
      return {
        valid: false,
        question: null
      };
    }

    const correctChoice =
      normalizeChoice(cleaned.correctAnswer);

    if (!correctChoice) {
      return {
        valid: false,
        question: null
      };
    }

    cleaned.correctAnswer = correctChoice;
  }

  if (cleaned.answerType === "fraction") {
    if (!parseFraction(cleaned.correctAnswer)) {
      return {
        valid: false,
        question: null
      };
    }

    cleaned.choices = [];
  }

  if (cleaned.answerType === "number") {
    if (parseNumber(cleaned.correctAnswer) === null) {
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

function extractGeminiText(data) {
  const parts =
    data?.candidates?.[0]?.content?.parts || [];

  return parts
    .map((part) => part?.text || "")
    .join("")
    .trim();
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
    `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${encodeURIComponent(apiKey)}`;

  const previousQuestions =
    Array.isArray(askedQuestions) &&
    askedQuestions.length > 0
      ? askedQuestions
          .slice(-15)
          .map((question, index) =>
            `${index + 1}. ${question}`
          )
          .join("\n")
      : "Aucune question précédente.";

  const prompt = `
Tu es le moteur de quiz de Klasévia, une plateforme éducative destinée aux élèves de Côte d'Ivoire.

Tu dois générer UNE SEULE nouvelle question de quiz.

INFORMATIONS PÉDAGOGIQUES :

Niveau scolaire :
${grade || "Non précisé"}

Série :
${serie || "Non précisée"}

Matière :
${subject || "Non précisée"}

Thème demandé :
${topic || "Non précisé"}

Difficulté souhaitée :
${difficulty || "normal"}

QUESTIONS DÉJÀ POSÉES :
${previousQuestions}

RÈGLES OBLIGATOIRES :

1. La question doit être adaptée exactement au niveau scolaire indiqué.
2. La question doit rester centrée sur le thème demandé.
3. Ne répète aucune question déjà posée.
4. Utilise un français clair et naturel.
5. Le contexte ivoirien peut être utilisé lorsqu'il est naturel.
6. Une seule question doit être générée.
7. Ne donne jamais la réponse dans questionText.
8. Ne mets pas de Markdown.
9. N'utilise pas de LaTeX.
10. Pour une question de fractions, utilise answerType "fraction".
11. Pour une question de calcul numérique, utilise answerType "number".
12. Pour les autres matières, privilégie answerType "qcm".
13. Pour un QCM, il doit y avoir exactement quatre choix.
14. Pour un QCM, correctAnswer doit être uniquement A, B, C ou D.
15. Pour une fraction, correctAnswer doit être sous la forme simple "3/4".
16. Pour un nombre, correctAnswer doit être une valeur numérique simple.
17. Vérifie soigneusement le calcul avant de fournir correctAnswer.
18. Vérifie une deuxième fois que correctAnswer correspond réellement à questionText.
19. L'explication doit être courte, pédagogique et correcte.
20. Ne génère aucune autre information en dehors de l'objet JSON demandé.

IMPORTANT POUR LES FRACTIONS :

Si la réponse correcte est par exemple six dixièmes, la forme simplifiée correcte est "3/5", et non "5/3".

Tu dois donc effectuer les calculs mathématiques correctement avant de répondre.
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
      responseFormat: {
        text: {
          mimeType: "application/json",
          schema: QUESTION_SCHEMA
        }
      },
      thinkingConfig: {
        thinkingLevel: "medium"
      },
      maxOutputTokens: 2048
    }
  };

  let lastError = null;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify(body)
      });

      const data = await response.json();

      if (!response.ok) {
        lastError = new Error(
          data?.error?.message ||
            `Erreur Gemini (${response.status})`
        );

        continue;
      }

      const text = extractGeminiText(data);

      if (!text) {
        lastError = new Error(
          "Gemini n'a renvoyé aucun contenu."
        );

        continue;
      }

      let parsed;

      try {
        parsed = JSON.parse(text);
      } catch (error) {
        lastError = new Error(
          "La réponse JSON de Gemini est invalide."
        );

        continue;
      }

      const validation =
        validateQuestion(parsed);

      if (!validation.valid) {
        lastError = new Error(
          "La question générée par Gemini ne respecte pas le format attendu."
        );

        continue;
      }

      return validation.question;
    } catch (error) {
      lastError = error;
    }
  }

  throw (
    lastError ||
    new Error(
      "Impossible de générer la question."
    )
  );
}

function displayCorrectAnswer(question) {
  if (question.answerType === "qcm") {
    const choice =
      normalizeChoice(question.correctAnswer);

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
      return `${choice}. ${question.choices[index]}`;
    }

    return choice || question.correctAnswer;
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
    `${question.questionText}`;

  if (question.answerType === "qcm") {
    text +=
      "\n\n" +
      `A. ${question.choices[0]}\n` +
      `B. ${question.choices[1]}\n` +
      `C. ${question.choices[2]}\n` +
      `D. ${question.choices[3]}` +
      "\n\nRéponds simplement par A, B, C ou D.";
  }

  if (question.answerType === "fraction") {
    text +=
      "\n\n" +
      "Écris ta réponse sous forme de fraction, par exemple 3/4.";
  }

  if (question.answerType === "number") {
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
  answeredNumber,
  total
}) {
  let text = "";

  if (isCorrect) {
    text +=
      "✅ Bonne réponse !\n\n" +
      `Ta réponse : ${userAnswer}\n\n`;

    if (question.explanation) {
      text += `${question.explanation}\n`;
    }
  } else {
    text +=
      "❌ Ce n'est pas la bonne réponse.\n\n" +
      `Ta réponse : ${userAnswer}\n` +
      `Bonne réponse : ${displayCorrectAnswer(question)}\n\n`;

    if (question.explanation) {
      text += `${question.explanation}\n`;
    }
  }

  text +=
    `\n📊 Score actuel : ${newScore}/${answeredNumber}`;

  return text;
}

function sanitizeQuizState(state) {
  if (!state || typeof state !== "object") {
    return null;
  }

  if (!state.active) {
    return null;
  }

  if (!state.currentQuestion) {
    return null;
  }

  const validation =
    validateQuestion(state.currentQuestion);

  if (!validation.valid) {
    return null;
  }

  const total =
    Number.isInteger(state.total) &&
    state.total > 0
      ? state.total
      : TOTAL_QUESTIONS;

  const questionNumber =
    Number.isInteger(state.questionNumber) &&
    state.questionNumber > 0
      ? state.questionNumber
      : 1;

  const score =
    Number.isInteger(state.score) &&
    state.score >= 0
      ? state.score
      : 0;

  const askedQuestions =
    Array.isArray(state.askedQuestions)
      ? state.askedQuestions
          .map((question) =>
            String(question || "").trim()
          )
          .filter(Boolean)
      : [];

  return {
    active: true,
    total,
    questionNumber,
    score,
    topic: String(state.topic || "").trim(),
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
  const topic = String(message || "").trim();

  const initialDifficulty =
    normalizeDifficulty(difficulty);

  const question = await generateQuestion({
    apiKey,
    grade,
    serie,
    subject,
    topic,
    difficulty: initialDifficulty,
    askedQuestions: []
  });

  const quizState = {
    active: true,
    total: TOTAL_QUESTIONS,
    questionNumber: 1,
    score: 0,
    topic,
    currentQuestion: question,
    askedQuestions: [
      question.questionText
    ],
    startedAt: new Date().toISOString()
  };

  const messageText =
    `🎯 Quiz lancé !\n\n` +
    formatQuestion(
      question,
      1,
      TOTAL_QUESTIONS
    );

  return {
    message: messageText,
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
    sanitizeQuizState(quizState);

  if (!state) {
    throw new Error(
      "Le quiz n'est plus actif. Demande-moi de lancer un nouveau quiz."
    );
  }

  const currentQuestion =
    state.currentQuestion;

  const userAnswer =
    String(message || "").trim();

  if (!userAnswer) {
    throw new Error(
      "Donne une réponse avant de valider."
    );
  }

  const isCorrect = gradeAnswer(
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
      question: currentQuestion,
      userAnswer,
      isCorrect,
      newScore,
      answeredNumber,
      total: state.total
    });

  if (answeredNumber >= state.total) {
    resultText +=
      "\n\n🏁 Quiz terminé !\n\n" +
      `Score final : ${newScore}/${state.total}`;

    if (newScore === state.total) {
      resultText +=
        "\n🌟 Excellent ! Toutes les réponses sont correctes.";
    } else if (
      newScore >= Math.ceil(state.total * 0.8)
    ) {
      resultText +=
        "\n👏 Très bon travail !";
    } else if (
      newScore >= Math.ceil(state.total * 0.5)
    ) {
      resultText +=
        "\n💪 Bon travail. Continue à t'entraîner !";
    } else {
      resultText +=
        "\n📚 Il faut encore s'entraîner. Tu vas progresser !";
    }

    const finishedState = {
      ...state,
      active: false,
      questionNumber: answeredNumber,
      score: newScore,
      currentQuestion: null,
      finishedAt: new Date().toISOString()
    };

    return {
      message: resultText,
      quizState: finishedState
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
      topic: state.topic,
      difficulty: nextDifficulty,
      askedQuestions:
        state.askedQuestions
    });

  const updatedAskedQuestions = [
    ...state.askedQuestions,
    nextQuestion.questionText
  ].slice(-20);

  const updatedState = {
    ...state,
    active: true,
    questionNumber: nextQuestionNumber,
    score: newScore,
    currentQuestion: nextQuestion,
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
    message: resultText,
    quizState: updatedState
  };
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({
      error: "Méthode non autorisée."
    });
  }

  try {
    const apiKey =
      process.env.GEMINI_API_KEY;

    if (!apiKey) {
      return res.status(500).json({
        error:
          "La clé GEMINI_API_KEY est absente de la configuration du serveur."
      });
    }

    const {
      action,
      message,
      grade,
      serie,
      subject,
      difficulty,
      quizState
    } = req.body || {};

    if (
      action !== "start" &&
      action !== "answer"
    ) {
      return res.status(400).json({
        error:
          "Action de quiz invalide. Utilise start ou answer."
      });
    }

    if (action === "start") {
      const result =
        await handleStart({
          apiKey,
          message,
          grade,
          serie,
          subject,
          difficulty
        });

      return res.status(200).json(result);
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

    return res.status(200).json(result);
  } catch (error) {
    console.error(
      "Erreur API quiz:",
      error
    );

    return res.status(500).json({
      error:
        error?.message ||
        "Une erreur est survenue pendant le quiz."
    });
  }
}