const MODEL = "gemini-3.8-flash";
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
      description: "Énoncé de la question, sans donner la réponse."
    },
    answerType: {
      type: "string",
      enum: ["qcm", "fraction", "number"],
      description:
        "qcm pour une question à choix multiples, fraction pour une fraction, number pour une valeur numérique."
    },
    choices: {
      type: "array",
      items: {
        type: "string"
      },
      description:
        "Pour un QCM, exactement 4 choix dans l'ordre A, B, C, D. Pour fraction et number, tableau vide."
    },
    correctAnswer: {
      type: "string",
      description:
        "Réponse correcte. Pour QCM : A, B, C ou D. Pour fraction : par exemple 3/4. Pour number : valeur numérique."
    },
    explanation: {
      type: "string",
      description:
        "Courte explication pédagogique permettant de comprendre pourquoi la réponse est correcte."
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

function sendJson(res, status, data) {
  res.status(status).json(data);
}

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

  if (!Number.isFinite(numerator) || !Number.isFinite(denominator)) {
    return null;
  }

  if (denominator === 0) {
    return null;
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
  let text = String(value || "")
    .trim()
    .replace(/\s+/g, "")
    .replace(",", ".");

  text = text.replace(/[^0-9eE+.-]/g, "");

  if (!text) {
    return null;
  }

  const number = Number(text);

  return Number.isFinite(number) ? number : null;
}

function normalizeChoice(value) {
  const text = String(value || "")
    .trim()
    .toUpperCase();

  if (!text) {
    return null;
  }

  const direct = text.match(/^[ABCD]$/);

  if (direct) {
    return direct[0];
  }

  const withPrefix = text.match(
    /^(?:RÉPONSE|REPONSE|CHOIX)?\s*([ABCD])(?:[.)\s].*)?$/
  );

  return withPrefix ? withPrefix[1] : null;
}

function gradeAnswer(question, userAnswer) {
  if (!question || !userAnswer) {
    return false;
  }

  switch (question.answerType) {
    case "qcm":
      return (
        normalizeChoice(userAnswer) ===
        normalizeChoice(question.correctAnswer)
      );

    case "fraction":
      return fractionsEqual(
        userAnswer,
        question.correctAnswer
      );

    case "number": {
      const userNumber = parseNumber(userAnswer);
      const correctNumber = parseNumber(
        question.correctAnswer
      );

      if (
        userNumber === null ||
        correctNumber === null
      ) {
        return false;
      }

      const tolerance =
        1e-9 * Math.max(1, Math.abs(correctNumber));

      return (
        Math.abs(userNumber - correctNumber) <= tolerance
      );
    }

    default:
      return false;
  }
}

function normalizeInitialDifficulty(difficulty) {
  const value = String(difficulty || "")
    .trim()
    .toLowerCase();

  if (value === "simple") {
    return "facile";
  }

  if (
    value === "détaillé" ||
    value === "detaille"
  ) {
    return "normal";
  }

  if (value === "difficile") {
    return "difficile";
  }

  return "normal";
}

function calculateNextDifficulty(
  score,
  answeredCount,
  requestedDifficulty
) {
  if (answeredCount <= 1) {
    return normalizeInitialDifficulty(
      requestedDifficulty
    );
  }

  const ratio = score / answeredCount;

  if (ratio >= 0.8) {
    return "difficile";
  }

  if (ratio < 0.4) {
    return "facile";
  }

  return "normal";
}

function validateQuestion(question) {
  if (!question || typeof question !== "object") {
    return false;
  }

  if (
    typeof question.questionId !== "string" ||
    !question.questionId.trim()
  ) {
    return false;
  }

  if (
    typeof question.questionText !== "string" ||
    !question.questionText.trim()
  ) {
    return false;
  }

  if (
    !["qcm", "fraction", "number"].includes(
      question.answerType
    )
  ) {
    return false;
  }

  if (!Array.isArray(question.choices)) {
    return false;
  }

  if (
    typeof question.correctAnswer !== "string" ||
    !question.correctAnswer.trim()
  ) {
    return false;
  }

  if (
    typeof question.explanation !== "string" ||
    !question.explanation.trim()
  ) {
    return false;
  }

  if (
    !["facile", "normal", "difficile"].includes(
      question.difficulty
    )
  ) {
    return false;
  }

  if (question.answerType === "qcm") {
    if (question.choices.length !== 4) {
      return false;
    }

    if (
      question.choices.some(
        (choice) =>
          typeof choice !== "string" ||
          !choice.trim()
      )
    ) {
      return false;
    }

    if (!normalizeChoice(question.correctAnswer)) {
      return false;
    }
  }

  if (question.answerType === "fraction") {
    if (!parseFraction(question.correctAnswer)) {
      return false;
    }

    if (question.choices.length !== 0) {
      return false;
    }
  }

  if (question.answerType === "number") {
    if (parseNumber(question.correctAnswer) === null) {
      return false;
    }

    if (question.choices.length !== 0) {
      return false;
    }
  }

  return true;
}

function getCorrectAnswerDisplay(question) {
  if (question.answerType === "qcm") {
    const letter = normalizeChoice(
      question.correctAnswer
    );

    const index = ["A", "B", "C", "D"].indexOf(letter);

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

function formatQuestion(question, number, total) {
  let text = `🎯 **Question ${number}/${total}**\n\n`;
  text += `${question.questionText}\n\n`;

  if (question.answerType === "qcm") {
    text += `**A.** ${question.choices[0]}\n`;
    text += `**B.** ${question.choices[1]}\n`;
    text += `**C.** ${question.choices[2]}\n`;
    text += `**D.** ${question.choices[3]}\n\n`;
    text += `👉 Réponds simplement par **A, B, C ou D**.`;
  } else if (question.answerType === "fraction") {
    text +=
      `👉 Écris ta réponse sous forme de fraction, par exemple **3/4**.`;
  } else {
    text +=
      `👉 Écris simplement la valeur numérique.`;
  }

  return text;
}

function cleanAskedQuestions(askedQuestions) {
  if (!Array.isArray(askedQuestions)) {
    return [];
  }

  return askedQuestions
    .filter(
      (item) =>
        typeof item === "string" &&
        item.trim()
    )
    .map((item) => item.trim())
    .slice(-20);
}

function questionWasAlreadyAsked(
  questionText,
  askedQuestions
) {
  const normalizedQuestion = String(
    questionText || ""
  )
    .trim()
    .toLowerCase();

  return cleanAskedQuestions(
    askedQuestions
  ).some(
    (item) =>
      item.trim().toLowerCase() ===
      normalizedQuestion
  );
}

function extractInteractionText(data) {
  if (
    data &&
    typeof data.output_text === "string" &&
    data.output_text.trim()
  ) {
    return data.output_text.trim();
  }

  const steps = Array.isArray(data?.steps)
    ? data.steps
    : [];

  const texts = [];

  for (const step of steps) {
    if (!Array.isArray(step?.content)) {
      continue;
    }

    for (const content of step.content) {
      if (
        content?.type === "text" &&
        typeof content.text === "string"
      ) {
        texts.push(content.text);
      }
    }
  }

  return texts.join("\n").trim();
}

function stripCodeFences(text) {
  return String(text || "")
    .trim()
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
}

async function generateQuestion({
  apiKey,
  grade,
  serie,
  subject,
  difficulty,
  topic,
  askedQuestions
}) {
  const asked = cleanAskedQuestions(
    askedQuestions
  );

  const previousQuestionsText =
    asked.length > 0
      ? asked
          .map(
            (question, index) =>
              `${index + 1}. ${question}`
          )
          .join("\n")
      : "Aucune question précédente.";

  const prompt = `
Tu es le moteur de quiz pédagogique de Klasévia.

Ta mission est de générer UNE SEULE nouvelle question de quiz.

CONTEXTE ÉLÈVE
- Niveau scolaire : ${grade || "non précisé"}
- Série : ${serie || "non précisée"}
- Matière : ${subject || "non précisée"}
- Sujet demandé : ${topic || "non précisé"}
- Difficulté souhaitée : ${difficulty || "normal"}

RÈGLES ABSOLUES

1. Écris en français clair, naturel et adapté à l'âge de l'élève.
2. La question doit réellement correspondre au niveau scolaire indiqué.
3. La question doit porter sur le sujet demandé.
4. Ne répète pas une question déjà posée.
5. Ne donne jamais la réponse dans l'énoncé.
6. Pour les mathématiques, vérifie soigneusement tous les calculs avant de fournir correctAnswer.
7. Pour une question de fractions, utilise answerType "fraction" et une réponse simple comme "3/4".
8. Pour une question numérique, utilise answerType "number".
9. Pour les matières où une réponse courte pourrait être ambiguë, privilégie answerType "qcm".
10. Pour un QCM, il doit y avoir exactement quatre choix : A, B, C et D.
11. Pour un QCM, correctAnswer doit être uniquement "A", "B", "C" ou "D".
12. Pour fraction et number, choices doit être un tableau vide.
13. L'explication doit être courte mais pédagogique.
14. Le contexte ivoirien peut être utilisé lorsque cela est naturel : FCFA, école, marché, cacao, transport, vie quotidienne, etc.
15. Ne mets aucun Markdown dans questionText.
16. Ne produis qu'un seul objet JSON correspondant exactement au schéma demandé.

QUESTIONS DÉJÀ POSÉES
${previousQuestionsText}

IMPORTANT POUR LES FRACTIONS

Si le sujet concerne les fractions, construis une question dont la réponse peut être vérifiée exactement.

Exemple :
questionText : "Une tablette comporte 10 morceaux. Awa en mange 4. Quelle fraction de la tablette reste-t-il ?"
correctAnswer : "3/5"

Vérifie le calcul avant de répondre.

Retourne uniquement l'objet JSON demandé.
`;

  const response = await fetch(
    "https://generativelanguage.googleapis.com/v1beta/interactions",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": apiKey
      },
      body: JSON.stringify({
        model: MODEL,
        input: prompt,
        response_format: {
          type: "text",
          mime_type: "application/json",
          schema: QUESTION_SCHEMA
        }
      })
    }
  );

  const responseText = await response.text();

  let data;

  try {
    data = JSON.parse(responseText);
  } catch {
    throw new Error(
      `Réponse Gemini invalide : ${responseText.slice(
        0,
        500
      )}`
    );
  }

  if (!response.ok) {
    const apiMessage =
      data?.error?.message ||
      data?.message ||
      "Erreur inconnue de Gemini.";

    throw new Error(
      `Gemini ${response.status} : ${apiMessage}`
    );
  }

  const rawText = extractInteractionText(data);

  if (!rawText) {
    throw new Error(
      "Gemini a répondu sans contenu exploitable."
    );
  }

  let question;

  try {
    question = JSON.parse(
      stripCodeFences(rawText)
    );
  } catch {
    throw new Error(
      `Gemini n'a pas renvoyé un JSON valide : ${rawText.slice(
        0,
        500
      )}`
    );
  }

  if (!validateQuestion(question)) {
    throw new Error(
      "La question générée par Gemini ne respecte pas le format attendu."
    );
  }

  if (
    questionWasAlreadyAsked(
      question.questionText,
      askedQuestions
    )
  ) {
    throw new Error(
      "Gemini a généré une question déjà posée."
    );
  }

  return question;
}

function createQuizState({
  topic,
  question,
  grade,
  serie,
  subject
}) {
  return {
    active: true,
    total: TOTAL_QUESTIONS,
    questionNumber: 1,
    score: 0,
    topic: topic || "",
    grade: grade || "",
    serie: serie || "",
    subject: subject || "",
    currentQuestion: question,
    askedQuestions: [question.questionText],
    startedAt: new Date().toISOString()
  };
}

function validateQuizState(quizState) {
  if (
    !quizState ||
    typeof quizState !== "object"
  ) {
    return false;
  }

  if (quizState.active !== true) {
    return false;
  }

  if (
    !Number.isInteger(
      quizState.questionNumber
    ) ||
    quizState.questionNumber < 1
  ) {
    return false;
  }

  if (
    !Number.isInteger(quizState.total) ||
    quizState.total < 1
  ) {
    return false;
  }

  if (
    !Number.isInteger(quizState.score) ||
    quizState.score < 0
  ) {
    return false;
  }

  if (
    quizState.score >
    quizState.questionNumber - 1
  ) {
    return false;
  }

  if (
    !validateQuestion(
      quizState.currentQuestion
    )
  ) {
    return false;
  }

  return true;
}

async function handleStart({
  apiKey,
  message,
  grade,
  serie,
  subject,
  difficulty
}) {
  const requestedDifficulty =
    normalizeInitialDifficulty(
      difficulty
    );

  const question = await generateQuestion({
    apiKey,
    grade,
    serie,
    subject,
    difficulty: requestedDifficulty,
    topic: message,
    askedQuestions: []
  });

  const quizState = createQuizState({
    topic: message,
    question,
    grade,
    serie,
    subject
  });

  const intro =
    `🎯 **Quiz Klasévia**\n\n` +
    `Matière : **${subject || "non précisée"}**\n` +
    `Niveau : **${grade || "non précisé"}**\n\n` +
    `Le quiz comporte **${TOTAL_QUESTIONS} questions**. ` +
    `Je corrige chaque réponse automatiquement.\n\n` +
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

async function handleAnswer({
  apiKey,
  message,
  quizState,
  grade,
  serie,
  subject,
  difficulty
}) {
  if (!validateQuizState(quizState)) {
    throw new Error(
      "Le quiz actif est incomplet ou invalide. Il faut redémarrer un nouveau quiz."
    );
  }

  const currentQuestion =
    quizState.currentQuestion;

  const userAnswer = String(
    message || ""
  ).trim();

  if (!userAnswer) {
    throw new Error(
      "Aucune réponse n'a été reçue du quiz."
    );
  }

  const isCorrect = gradeAnswer(
    currentQuestion,
    userAnswer
  );

  const answeredQuestionNumber =
    quizState.questionNumber;

  const newScore =
    quizState.score +
    (isCorrect ? 1 : 0);

  let correction;

  if (isCorrect) {
    correction =
      `✅ **Bonne réponse !**\n\n` +
      `Ta réponse : **${userAnswer}**\n\n` +
      `${currentQuestion.explanation}`;
  } else {
    correction =
      `❌ **Ce n'est pas la bonne réponse.**\n\n` +
      `Ta réponse : **${userAnswer}**\n\n` +
      `Bonne réponse : **${getCorrectAnswerDisplay(
        currentQuestion
      )}**\n\n` +
      `${currentQuestion.explanation}`;
  }

  if (
    answeredQuestionNumber >=
    quizState.total
  ) {
    const finalState = {
      ...quizState,
      active: false,
      score: newScore,
      questionNumber: answeredQuestionNumber,
      currentQuestion: null,
      finishedAt: new Date().toISOString()
    };

    const finalMessage =
      correction +
      `\n\n🏁 **Quiz terminé !**\n\n` +
      `### Résultat\n` +
      `**${newScore}/${quizState.total}**\n\n` +
      (
        newScore === quizState.total
          ? "🌟 Excellent ! Toutes les réponses sont correctes."
          : newScore >= 8
          ? "👏 Très bon travail !"
          : newScore >= 5
          ? "👍 Bon travail. Continue à t'entraîner !"
          : "💪 Continue tes efforts. Tu vas progresser !"
      );

    return {
      message: finalMessage,
      quizState: finalState
    };
  }

  const nextQuestionNumber =
    answeredQuestionNumber + 1;

  const nextDifficulty =
    calculateNextDifficulty(
      newScore,
      answeredQuestionNumber,
      difficulty
    );

  let nextQuestion = null;
  let lastError = null;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      nextQuestion =
        await generateQuestion({
          apiKey,
          grade:
            quizState.grade || grade,
          serie:
            quizState.serie || serie,
          subject:
            quizState.subject || subject,
          difficulty: nextDifficulty,
          topic: quizState.topic,
          askedQuestions:
            quizState.askedQuestions
        });

      break;
    } catch (error) {
      lastError = error;
    }
  }

  if (!nextQuestion) {
    throw (
      lastError ||
      new Error(
        "Impossible de générer la prochaine question."
      )
    );
  }

  const updatedAskedQuestions = [
    ...cleanAskedQuestions(
      quizState.askedQuestions
    ),
    nextQuestion.questionText
  ].slice(-20);

  const nextState = {
    ...quizState,
    active: true,
    questionNumber: nextQuestionNumber,
    score: newScore,
    currentQuestion: nextQuestion,
    askedQuestions:
      updatedAskedQuestions
  };

  const nextMessage =
    correction +
    `\n\n---\n\n` +
    formatQuestion(
      nextQuestion,
      nextQuestionNumber,
      quizState.total
    );

  return {
    message: nextMessage,
    quizState: nextState
  };
}

export default async function handler(
  req,
  res
) {
  if (req.method !== "POST") {
    return sendJson(res, 405, {
      error:
        "Méthode non autorisée. Utilise POST."
    });
  }

  try {
    const apiKey =
      process.env.GEMINI_API_KEY;

    if (!apiKey) {
      return sendJson(res, 500, {
        error:
          "La variable GEMINI_API_KEY est absente de Vercel."
      });
    }

    const body =
      req.body && typeof req.body === "object"
        ? req.body
        : {};

    const action = String(
      body.action || ""
    )
      .trim()
      .toLowerCase();

    const message = String(
      body.message || ""
    ).trim();

    const grade = String(
      body.grade || ""
    ).trim();

    const serie = String(
      body.serie || ""
    ).trim();

    const subject = String(
      body.subject || ""
    ).trim();

    const difficulty = String(
      body.difficulty || ""
    ).trim();

    const quizState =
      body.quizState || null;

    if (
      action !== "start" &&
      action !== "answer"
    ) {
      return sendJson(res, 400, {
        error:
          "Action de quiz invalide. Utilise start ou answer."
      });
    }

    if (!message) {
      return sendJson(res, 400, {
        error:
          "Le message du quiz est vide."
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

      return sendJson(res, 200, {
        ok: true,
        message: result.message,
        quizState: result.quizState
      });
    }

    const result =
      await handleAnswer({
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
      message: result.message,
      quizState: result.quizState
    });
  } catch (error) {
    console.error(
      "Erreur api/quiz.js:",
      error
    );

    return sendJson(res, 500, {
      ok: false,
      error:
        error?.message ||
        "Une erreur est survenue dans le moteur du quiz."
    });
  }
}