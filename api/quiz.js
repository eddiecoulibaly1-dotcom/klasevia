// api/quiz.js
//
// Klasévia — moteur de quiz
//
// Architecture :
// - Gemini génère UNE question structurée à la fois.
// - La correction est faite localement en JavaScript.
// - Les fractions sont comparées mathématiquement.
// - Les réponses QCM sont comparées sans ambiguïté.
// - Les erreurs 503/429 sont retentées automatiquement.
// - Plusieurs modèles peuvent servir de secours.
// - Aucun état de quiz n'est déduit à partir de l'historique de conversation.
// - Le frontend envoie explicitement quizState.
//

const TOTAL_QUESTIONS = 10;

// Ordre volontaire :
// 1. Flash-Lite pour privilégier rapidité/coût/capacité.
// 2. Flash comme secours.
// 3. 3.8 Flash seulement en dernier recours.
const MODELS = [
  "gemini-3.5-flash-lite",
  "gemini-3.6-flash",
  "gemini-3.8-flash",
];

const MAX_RETRIES_PER_MODEL = 2;

const QUESTION_SCHEMA = {
  type: "object",
  properties: {
    questionId: {
      type: "string",
    },

    questionText: {
      type: "string",
    },

    answerType: {
      type: "string",
      enum: ["qcm", "fraction", "number"],
    },

    choices: {
      type: "array",
      items: {
        type: "string",
      },
    },

    correctAnswer: {
      type: "string",
    },

    explanation: {
      type: "string",
    },

    difficulty: {
      type: "string",
      enum: ["facile", "normal", "difficile"],
    },
  },

  required: [
    "questionId",
    "questionText",
    "answerType",
    "choices",
    "correctAnswer",
    "explanation",
    "difficulty",
  ],
};


// ------------------------------------------------------------
// OUTILS GÉNÉRAUX
// ------------------------------------------------------------

function cleanText(value) {
  return String(value || "").trim();
}


function normalizeText(value) {
  return cleanText(value)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}


// ------------------------------------------------------------
// FRACTIONS
// ------------------------------------------------------------

function gcd(a, b) {
  a = Math.abs(Number(a));
  b = Math.abs(Number(b));

  while (b !== 0) {
    const temp = a % b;
    a = b;
    b = temp;
  }

  return a || 1;
}


function parseFraction(value) {
  let text = cleanText(value);

  if (!text) {
    return null;
  }

  // Accepte :
  // 3/4
  // 3 / 4
  // +3/4
  // -3/4
  text = text.replace(/\s+/g, "");

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

  // On déplace le signe au numérateur.
  if (denominator < 0) {
    numerator *= -1;
    denominator *= -1;
  }

  const divisor = gcd(numerator, denominator);

  return {
    numerator: numerator / divisor,
    denominator: denominator / divisor,
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


function formatFraction(fraction) {
  const parsed = parseFraction(fraction);

  if (!parsed) {
    return cleanText(fraction);
  }

  if (parsed.denominator === 1) {
    return String(parsed.numerator);
  }

  return `${parsed.numerator}/${parsed.denominator}`;
}


// ------------------------------------------------------------
// NOMBRES
// ------------------------------------------------------------

function parseNumber(value) {
  let text = cleanText(value);

  if (!text) {
    return null;
  }

  text = text
    .replace(/\s/g, "")
    .replace(",", ".");

  // Autorise uniquement une forme numérique raisonnable.
  if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(text)) {
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
    1e-9 * Math.max(1, Math.abs(b));

  return Math.abs(a - b) <= tolerance;
}


// ------------------------------------------------------------
// QCM
// ------------------------------------------------------------

function normalizeChoice(value) {
  const text = cleanText(value).toUpperCase();

  if (!text) {
    return null;
  }

  // Accepte :
  // A
  // A.
  // A)
  // Réponse A
  // réponse : A
  const match = text.match(
    /^(?:R[ÉE]PONSE\s*(?:DE)?\s*)?([ABCD])(?:[\s.)\-:]+.*)?$/
  );

  if (!match) {
    return null;
  }

  return match[1];
}


// ------------------------------------------------------------
// CORRECTION DÉTERMINISTE
// ------------------------------------------------------------

function gradeAnswer(question, userAnswer) {
  if (!question) {
    return false;
  }

  const answer = cleanText(userAnswer);

  if (!answer) {
    return false;
  }

  switch (question.answerType) {
    case "qcm":
      return (
        normalizeChoice(answer) ===
        normalizeChoice(question.correctAnswer)
      );

    case "fraction":
      return fractionsEqual(
        answer,
        question.correctAnswer
      );

    case "number":
      return numbersEqual(
        answer,
        question.correctAnswer
      );

    default:
      return false;
  }
}


// ------------------------------------------------------------
// DIFFICULTÉ
// ------------------------------------------------------------

function normalizeInitialDifficulty(value) {
  const text = normalizeText(value);

  if (
    text === "simple" ||
    text === "facile"
  ) {
    return "facile";
  }

  if (
    text === "detaillé" ||
    text === "detaille" ||
    text === "difficile"
  ) {
    return "normal";
  }

  return "normal";
}


function chooseNextDifficulty(
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


// ------------------------------------------------------------
// VALIDATION D'UNE QUESTION GEMINI
// ------------------------------------------------------------

function validateQuestion(question) {
  if (!question || typeof question !== "object") {
    return false;
  }

  if (!cleanText(question.questionId)) {
    return false;
  }

  if (!cleanText(question.questionText)) {
    return false;
  }

  if (
    !["qcm", "fraction", "number"].includes(
      question.answerType
    )
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

  if (!Array.isArray(question.choices)) {
    return false;
  }

  if (!cleanText(question.correctAnswer)) {
    return false;
  }

  if (!cleanText(question.explanation)) {
    return false;
  }

  // QCM
  if (question.answerType === "qcm") {
    if (question.choices.length !== 4) {
      return false;
    }

    if (
      question.choices.some(
        (choice) => !cleanText(choice)
      )
    ) {
      return false;
    }

    const correct = normalizeChoice(
      question.correctAnswer
    );

    if (!["A", "B", "C", "D"].includes(correct)) {
      return false;
    }

    return true;
  }

  // Fraction
  if (question.answerType === "fraction") {
    if (question.choices.length !== 0) {
      return false;
    }

    return Boolean(
      parseFraction(question.correctAnswer)
    );
  }

  // Nombre
  if (question.answerType === "number") {
    if (question.choices.length !== 0) {
      return false;
    }

    return (
      parseNumber(question.correctAnswer) !== null
    );
  }

  return false;
}


// ------------------------------------------------------------
// EXTRACTION DU TEXTE DE LA RÉPONSE GEMINI
// ------------------------------------------------------------

function extractInteractionText(data) {
  if (!data) {
    return "";
  }

  // Format pratique éventuel.
  if (
    typeof data.output_text === "string" &&
    data.output_text.trim()
  ) {
    return data.output_text.trim();
  }

  // Format REST actuel :
  // steps -> model_output -> content -> text
  if (Array.isArray(data.steps)) {
    const parts = [];

    for (const step of data.steps) {
      if (
        step &&
        step.type === "model_output" &&
        Array.isArray(step.content)
      ) {
        for (const content of step.content) {
          if (
            content &&
            content.type === "text" &&
            typeof content.text === "string"
          ) {
            parts.push(content.text);
          }
        }
      }
    }

    if (parts.length > 0) {
      return parts.join("\n").trim();
    }
  }

  // Ancien format éventuel.
  if (Array.isArray(data.outputs)) {
    const parts = data.outputs
      .filter(
        (item) =>
          item &&
          item.type === "text" &&
          typeof item.text === "string"
      )
      .map((item) => item.text);

    if (parts.length > 0) {
      return parts.join("\n").trim();
    }
  }

  return "";
}


// ------------------------------------------------------------
// NETTOYAGE JSON
// ------------------------------------------------------------

function parseJsonText(text) {
  let value = cleanText(text);

  if (!value) {
    throw new Error(
      "Gemini n'a retourné aucun contenu."
    );
  }

  // Retire éventuellement un bloc ```json ... ```
  value = value
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();

  try {
    return JSON.parse(value);
  } catch (error) {
    // Dernière tentative : trouver le premier objet JSON.
    const firstBrace = value.indexOf("{");
    const lastBrace = value.lastIndexOf("}");

    if (
      firstBrace !== -1 &&
      lastBrace > firstBrace
    ) {
      const possibleJson = value.slice(
        firstBrace,
        lastBrace + 1
      );

      return JSON.parse(possibleJson);
    }

    throw error;
  }
}


// ------------------------------------------------------------
// APPEL GEMINI
// ------------------------------------------------------------

function isRetryableStatus(status) {
  return (
    status === 408 ||
    status === 429 ||
    status === 500 ||
    status === 502 ||
    status === 503 ||
    status === 504
  );
}


async function sleep(milliseconds) {
  await new Promise((resolve) =>
    setTimeout(resolve, milliseconds)
  );
}


function buildPrompt({
  grade,
  serie,
  subject,
  topic,
  difficulty,
  questionNumber,
  total,
  askedQuestions,
}) {
  const safeGrade =
    cleanText(grade) || "non précisé";

  const safeSerie =
    cleanText(serie) || "Non précisée";

  const safeSubject =
    cleanText(subject) || "Autre";

  const safeTopic =
    cleanText(topic) || "révision générale";

  const previousQuestions =
    Array.isArray(askedQuestions) &&
    askedQuestions.length > 0
      ? askedQuestions
          .slice(-10)
          .map(
            (question, index) =>
              `${index + 1}. ${cleanText(question)}`
          )
          .join("\n")
      : "Aucune question précédente.";

  const fractionInstruction =
    normalizeText(topic).includes("fraction")
      ? `
Le thème concerne les FRACTIONS.

Pour une question de calcul de fraction :
- utilise answerType = "fraction" ;
- correctAnswer doit être une fraction simple comme "3/4" ;
- n'utilise PAS de LaTeX ;
- n'utilise PAS de fraction empilée ;
- vérifie soigneusement le calcul ;
- deux fractions équivalentes doivent avoir la même valeur mathématique.
`
      : "";

  return `
Tu es le moteur de quiz pédagogique de Klasévia,
une plateforme éducative destinée principalement aux élèves
de Côte d'Ivoire.

Tu dois générer UNE SEULE question de quiz.

Niveau scolaire : ${safeGrade}
Série : ${safeSerie}
Matière : ${safeSubject}
Thème demandé : ${safeTopic}
Difficulté souhaitée : ${difficulty}

Question actuelle : ${questionNumber}/${total}

Questions déjà posées :
${previousQuestions}

RÈGLES ABSOLUES :

1. La question doit correspondre au niveau scolaire demandé.
2. La question doit correspondre à la matière et au thème.
3. Ne répète aucune question déjà posée.
4. Une seule question doit être générée.
5. Vérifie toi-même le calcul avant de fournir correctAnswer.
6. correctAnswer doit être EXACTEMENT la bonne réponse.
7. explanation doit expliquer brièvement pourquoi.
8. questionText ne doit jamais révéler la réponse.
9. Le contenu doit être rédigé en français.
10. Pas de Markdown.
11. Pas de LaTeX.
12. Pas de HTML.

TYPES DE QUESTIONS :

- qcm :
  exactement 4 choix dans choices.
  Les choix correspondent à A, B, C et D.
  correctAnswer doit être "A", "B", "C" ou "D".

- fraction :
  choices doit être [].
  correctAnswer doit être une fraction sous la forme "a/b".

- number :
  choices doit être [].
  correctAnswer doit être un nombre.

Choisis le type de réponse le plus naturel pour la question.

${fractionInstruction}

IMPORTANT :
Retourne UNIQUEMENT l'objet JSON demandé par le schéma.
Ne mets aucun texte avant ou après le JSON.
`;
}


async function callGeminiModel(model, prompt) {
  const apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey) {
    throw new Error(
      "La variable GEMINI_API_KEY est absente de Vercel."
    );
  }

  const url =
    "https://generativelanguage.googleapis.com/v1beta/interactions";

  const body = {
    model,
    input: prompt,

    response_format: {
      type: "text",
      mime_type: "application/json",
      schema: QUESTION_SCHEMA,
    },

    generation_config: {
      max_output_tokens: 1200,
    },
  };

  const response = await fetch(url, {
    method: "POST",

    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": apiKey,
    },

    body: JSON.stringify(body),
  });

  const rawText = await response.text();

  let data = null;

  try {
    data = rawText ? JSON.parse(rawText) : null;
  } catch {
    data = null;
  }

  if (!response.ok) {
    const serverMessage =
      data?.error?.message ||
      data?.message ||
      rawText ||
      `HTTP ${response.status}`;

    const error = new Error(
      `Gemini ${model} — HTTP ${response.status} — ${serverMessage}`
    );

    error.status = response.status;
    error.model = model;
    error.retryable =
      isRetryableStatus(response.status);

    throw error;
  }

  const outputText =
    extractInteractionText(data);

  if (!outputText) {
    throw new Error(
      `Gemini ${model} n'a retourné aucun texte exploitable.`
    );
  }

  const question =
    parseJsonText(outputText);

  if (!validateQuestion(question)) {
    throw new Error(
      `Gemini ${model} a retourné une question invalide.`
    );
  }

  return question;
}


// ------------------------------------------------------------
// GÉNÉRATION AVEC RETRY + FALLBACK
// ------------------------------------------------------------

async function generateQuestion(options) {
  const errors = [];

  for (const model of MODELS) {
    for (
      let attempt = 1;
      attempt <= MAX_RETRIES_PER_MODEL;
      attempt++
    ) {
      try {
        const question =
          await callGeminiModel(
            model,
            buildPrompt(options)
          );

        return question;
      } catch (error) {
        errors.push({
          model,
          attempt,
          status: error?.status || null,
          message:
            error?.message ||
            "Erreur inconnue",
        });

        const retryable =
          error?.retryable === true ||
          isRetryableStatus(error?.status);

        if (!retryable) {
          // Erreur de configuration ou de syntaxe :
          // inutile de marteler le même modèle.
          break;
        }

        // Délai progressif :
        // tentative 1 -> 1,5 s
        // tentative 2 -> 3 s
        if (attempt < MAX_RETRIES_PER_MODEL) {
          const delay =
            1500 * Math.pow(2, attempt - 1);

          await sleep(delay);
        }
      }
    }
  }

  const finalError =
    new Error(
      "Gemini est momentanément indisponible sur les modèles configurés."
    );

  finalError.details = errors;

  throw finalError;
}


// ------------------------------------------------------------
// AFFICHAGE D'UNE QUESTION
// ------------------------------------------------------------

function formatQuestion(
  question,
  questionNumber,
  total
) {
  let text =
    `🎯 Question ${questionNumber}/${total}\n\n` +
    question.questionText;

  if (question.answerType === "qcm") {
    text +=
      `\n\nA. ${question.choices[0]}` +
      `\nB. ${question.choices[1]}` +
      `\nC. ${question.choices[2]}` +
      `\nD. ${question.choices[3]}`;

    text +=
      "\n\n👉 Réponds par A, B, C ou D.";
  }

  if (question.answerType === "fraction") {
    text +=
      "\n\n👉 Écris ta réponse sous forme de fraction, par exemple : 3/4.";
  }

  if (question.answerType === "number") {
    text +=
      "\n\n👉 Écris uniquement ta réponse numérique.";
  }

  return text;
}


// ------------------------------------------------------------
// AFFICHAGE DE LA BONNE RÉPONSE
// ------------------------------------------------------------

function formatCorrectAnswer(question) {
  if (!question) {
    return "";
  }

  if (question.answerType === "qcm") {
    const letter =
      normalizeChoice(
        question.correctAnswer
      );

    const index =
      ["A", "B", "C", "D"].indexOf(letter);

    if (index >= 0) {
      return `${letter}. ${question.choices[index]}`;
    }

    return letter || question.correctAnswer;
  }

  if (question.answerType === "fraction") {
    return formatFraction(
      question.correctAnswer
    );
  }

  return cleanText(
    question.correctAnswer
  );
}


// ------------------------------------------------------------
// ÉTAT DE QUIZ
// ------------------------------------------------------------

function createInitialQuizState(
  topic,
  question
) {
  return {
    active: true,
    total: TOTAL_QUESTIONS,
    questionNumber: 1,
    score: 0,
    topic: cleanText(topic),
    currentQuestion: question,
    askedQuestions: [
      question.questionText,
    ],
    startedAt: new Date().toISOString(),
  };
}


// ------------------------------------------------------------
// DÉMARRER UN QUIZ
// ------------------------------------------------------------

async function startQuiz(body) {
  const {
    message,
    grade,
    serie,
    subject,
    difficulty,
  } = body;

  const topic =
    cleanText(message) ||
    "révision générale";

  const question =
    await generateQuestion({
      grade,
      serie,
      subject,
      topic,
      difficulty:
        normalizeInitialDifficulty(
          difficulty
        ),
      questionNumber: 1,
      total: TOTAL_QUESTIONS,
      askedQuestions: [],
    });

  const quizState =
    createInitialQuizState(
      topic,
      question
    );

  const assistantMessage =
    `🎯 **Quiz Klasévia**\n\n` +
    `Je vais te poser ${TOTAL_QUESTIONS} questions.\n` +
    `Je corrige chaque réponse automatiquement.\n\n` +
    formatQuestion(
      question,
      1,
      TOTAL_QUESTIONS
    );

  return {
    message: assistantMessage,
    quizState,
  };
}


// ------------------------------------------------------------
// RÉPONDRE À UNE QUESTION
// ------------------------------------------------------------

async function answerQuiz(body) {
  const {
    message,
    grade,
    serie,
    subject,
    difficulty,
    quizState,
  } = body;

  if (
    !quizState ||
    quizState.active !== true ||
    !quizState.currentQuestion
  ) {
    throw new Error(
      "Aucun quiz actif n'a été trouvé."
    );
  }

  const currentQuestion =
    quizState.currentQuestion;

  const userAnswer =
    cleanText(message);

  if (!userAnswer) {
    throw new Error(
      "Aucune réponse n'a été reçue du quiz."
    );
  }

  const isCorrect =
    gradeAnswer(
      currentQuestion,
      userAnswer
    );

  const currentQuestionNumber =
    Number(
      quizState.questionNumber || 1
    );

  const oldScore =
    Number(
      quizState.score || 0
    );

  const newScore =
    oldScore +
    (isCorrect ? 1 : 0);

  const answeredCount =
    currentQuestionNumber;

  // ----------------------------------------------------------
  // FIN DU QUIZ
  // ----------------------------------------------------------

  if (
    currentQuestionNumber >=
    TOTAL_QUESTIONS
  ) {
    const resultText = isCorrect
      ? "✅ Bonne réponse !"
      : "❌ Ce n'est pas la bonne réponse.";

    const correction =
      isCorrect
        ? `Ta réponse : ${userAnswer}`
        : `Ta réponse : ${userAnswer}\nBonne réponse : ${formatCorrectAnswer(
            currentQuestion
          )}`;

    const finalMessage =
      `${resultText}\n\n` +
      `${correction}\n\n` +
      `${currentQuestion.explanation}\n\n` +
      `🏁 **Quiz terminé !**\n\n` +
      `Score final : **${newScore}/${TOTAL_QUESTIONS}**`;

    const finishedState = {
      ...quizState,
      active: false,
      questionNumber:
        currentQuestionNumber,
      score: newScore,
      currentQuestion: null,
      finishedAt:
        new Date().toISOString(),
    };

    return {
      message: finalMessage,
      quizState: finishedState,
    };
  }

  // ----------------------------------------------------------
  // QUESTION SUIVANTE
  // ----------------------------------------------------------

  const nextQuestionNumber =
    currentQuestionNumber + 1;

  const nextDifficulty =
    chooseNextDifficulty(
      newScore,
      answeredCount,
      difficulty
    );

  const askedQuestions =
    Array.isArray(
      quizState.askedQuestions
    )
      ? quizState.askedQuestions
      : [];

  const nextQuestion =
    await generateQuestion({
      grade,
      serie,
      subject,
      topic:
        quizState.topic ||
        "révision générale",
      difficulty:
        nextDifficulty,
      questionNumber:
        nextQuestionNumber,
      total: TOTAL_QUESTIONS,
      askedQuestions,
    });

  const updatedAskedQuestions = [
    ...askedQuestions,
    nextQuestion.questionText,
  ].slice(-20);

  const updatedQuizState = {
    ...quizState,
    active: true,
    questionNumber:
      nextQuestionNumber,
    score: newScore,
    currentQuestion:
      nextQuestion,
    askedQuestions:
      updatedAskedQuestions,
  };

  const resultText = isCorrect
    ? "✅ **Bonne réponse !**"
    : "❌ **Ce n'est pas la bonne réponse.**";

  const correction =
    isCorrect
      ? `Ta réponse : ${userAnswer}`
      : `Ta réponse : ${userAnswer}\nBonne réponse : ${formatCorrectAnswer(
          currentQuestion
        )}`;

  const assistantMessage =
    `${resultText}\n\n` +
    `${correction}\n\n` +
    `${currentQuestion.explanation}\n\n` +
    `📊 Score : **${newScore}/${answeredCount}**\n\n` +
    `────────────────────\n\n` +
    formatQuestion(
      nextQuestion,
      nextQuestionNumber,
      TOTAL_QUESTIONS
    );

  return {
    message: assistantMessage,
    quizState: updatedQuizState,
  };
}


// ------------------------------------------------------------
// HANDLER VERCEL
// ------------------------------------------------------------

export default async function handler(
  req,
  res
) {
  // ----------------------------------------------------------
  // Méthode HTTP
  // ----------------------------------------------------------

  if (req.method !== "POST") {
    return res.status(405).json({
      error:
        "Méthode non autorisée. Utilise POST.",
    });
  }

  try {
    const body =
      req.body && typeof req.body === "object"
        ? req.body
        : {};

    const action =
      cleanText(body.action)
        .toLowerCase();

    // --------------------------------------------------------
    // DÉMARRAGE
    // --------------------------------------------------------

    if (action === "start") {
      const result =
        await startQuiz(body);

      return res.status(200).json(result);
    }

    // --------------------------------------------------------
    // RÉPONSE
    // --------------------------------------------------------

    if (action === "answer") {
      const result =
        await answerQuiz(body);

      return res.status(200).json(result);
    }

    return res.status(400).json({
      error:
        "Action de quiz inconnue. Utilise start ou answer.",
    });
  } catch (error) {
    console.error(
      "Klasévia quiz error:",
      error
    );

    const status =
      Number(error?.status) >= 400 &&
      Number(error?.status) < 600
        ? Number(error.status)
        : 500;

    let publicMessage =
      error?.message ||
      "Une erreur est survenue pendant le quiz.";

    // Message utilisateur plus clair
    // pour les indisponibilités Gemini.
    if (
      status === 429 ||
      status === 503 ||
      status === 502 ||
      status === 504
    ) {
      publicMessage =
        "Le service IA de Klasévia est momentanément très sollicité. " +
        "Le système a essayé plusieurs fois automatiquement. " +
        "Réessaie dans quelques instants.";
    }

    return res.status(status).json({
      error: publicMessage,
    });
  }
}