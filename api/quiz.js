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
        "Réponse correcte canonique."
    },
    explanation: {
      type: "string",
      description:
        "Explication pédagogique courte et correcte."
    },
    difficulty: {
      type: "string",
      enum: ["facile", "normal", "difficile"],
      description:
        "Difficulté de la question."
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
    /^(-?\d+)\/(-?\d+)$/
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

  if (denominator < 0) {
    numerator *= -1;
    denominator *= -1;
  }

  const divisor = gcd(
    numerator,
    denominator
  );

  return {
    numerator: numerator / divisor,
    denominator: denominator / divisor
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

  if (
    first === null ||
    second === null
  ) {
    return false;
  }

  return (
    Math.abs(first - second) < 0.000001
  );
}

function normalizeChoice(value) {
  const text = normalizeText(value);

  const match = text.match(
    /^([abcd])(?:[\.\)\-:]|$)/
  );

  return match
    ? match[1].toUpperCase()
    : "";
}

function validateQuestion(question) {
  if (!question) {
    throw new Error(
      "La question générée est vide."
    );
  }

  if (
    !question.questionId ||
    !question.questionText ||
    !question.correctAnswer
  ) {
    throw new Error(
      "La question générée est incomplète."
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

  if (!Array.isArray(question.choices)) {
    question.choices = [];
  }

  if (question.answerType === "qcm") {
    if (question.choices.length !== 4) {
      throw new Error(
        "Un QCM doit contenir exactement quatre choix."
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
        "La bonne réponse du QCM doit être A, B, C ou D."
      );
    }

    question.correctAnswer =
      correctChoice;
  }

  if (question.answerType === "fraction") {
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

  if (question.answerType === "number") {
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

function extractJson(text) {
  const raw = String(text || "").trim();

  if (!raw) {
    throw new Error(
      "Gemini n'a renvoyé aucune donnée."
    );
  }

  try {
    return JSON.parse(raw);
  } catch {
    // Tentative de récupération si Gemini
    // a ajouté accidentellement du texte autour du JSON.
  }

  const firstBrace = raw.indexOf("{");
  const lastBrace = raw.lastIndexOf("}");

  if (
    firstBrace !== -1 &&
    lastBrace !== -1 &&
    lastBrace > firstBrace
  ) {
    const possibleJson = raw.slice(
      firstBrace,
      lastBrace + 1
    );

    try {
      return JSON.parse(possibleJson);
    } catch {
      // On continue vers l'erreur finale.
    }
  }

  throw new Error(
    "La réponse JSON de Gemini est invalide."
  );
}

async function callGeminiModel(
  apiKey,
  model,
  prompt
) {
  const url =
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent` +
    `?key=${encodeURIComponent(apiKey)}`;

  const response = await fetch(
    url,
    {
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

          maxOutputTokens: 3000
        }
      })
    }
  );

  const responseText =
    await response.text();

  if (!response.ok) {
    console.error(
      `Gemini ${model} HTTP ${response.status}:`,
      responseText
    );

    const error = new Error(
      `Gemini ${model} HTTP ${response.status}`
    );

    error.status =
      response.status;

    throw error;
  }

  let data;

  try {
    data = JSON.parse(
      responseText
    );
  } catch {
    console.error(
      `Réponse non JSON de Gemini ${model}:`,
      responseText
    );

    throw new Error(
      "Gemini a renvoyé une réponse invalide."
    );
  }

  const raw =
    data?.candidates?.[0]
      ?.content?.parts
      ?.map(
        part =>
          part?.text || ""
      )
      .join("")
      .trim();

  if (!raw) {
    throw new Error(
      "Gemini n'a pas généré de question."
    );
  }

  const question =
    extractJson(raw);

  return validateQuestion(
    question
  );
}

async function callGeminiWithFallback(
  apiKey,
  prompt
) {
  let lastError = null;

  for (const model of MODELS) {
    try {
      console.log(
        `Tentative quiz avec ${model}`
      );

      const question =
        await callGeminiModel(
          apiKey,
          model,
          prompt
        );

      console.log(
        `Quiz généré avec ${model}`
      );

      return question;
    } catch (error) {
      lastError = error;

      console.error(
        `Échec avec ${model}:`,
        error?.message
      );

      /*
       * On essaie automatiquement le modèle
       * suivant en cas d'indisponibilité.
       */
      continue;
    }
  }

  throw (
    lastError ||
    new Error(
      "Tous les modèles Gemini sont indisponibles."
    )
  );
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
  const previousQuestions =
    Array.isArray(
      askedQuestions
    ) &&
    askedQuestions.length > 0
      ? askedQuestions
          .slice(-10)
          .map(
            (question, index) =>
              `${index + 1}. ${question}`
          )
          .join("\n")
      : "Aucune question précédente.";

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
Tu es le moteur officiel de génération des quiz de Klasévia.

Tu dois générer UNE SEULE question.

INFORMATIONS DE L'ÉLÈVE

Niveau scolaire :
${grade}

Matière :
${subject}

Série :
${serie || "Non précisée"}

Thème :
${topic || subject}

Difficulté :
${difficulty || "normal"}

Numéro de question :
${questionNumber}

Score actuel :
${score}

RÈGLES PÉDAGOGIQUES

1. La question doit être adaptée au niveau indiqué.
2. La question doit correspondre exactement au thème.
3. Ne répète aucune question déjà posée.
4. La réponse doit être parfaitement déterminée.
5. La question ne doit être ni ambiguë ni trompeuse.
6. Vérifie le calcul avant de donner correctAnswer.
7. L'explication doit être correcte.
8. Ne mets pas la réponse directement dans questionText.
9. Ne mets aucun Markdown dans les champs JSON.
10. Retourne exactement un objet JSON conforme au schéma.

TYPES AUTORISÉS

QCM :
- answerType = "qcm"
- exactement quatre choix
- choices = [A, B, C, D]
- correctAnswer = "A", "B", "C" ou "D"

FRACTION :
- answerType = "fraction"
- choices = []
- correctAnswer sous forme a/b
- les fractions équivalentes seront acceptées par le moteur

NOMBRE :
- answerType = "number"
- choices = []
- correctAnswer doit être un nombre exact

RÈGLES SPÉCIALES POUR LES FRACTIONS

${
  isMath && isFraction
    ? `
Le quiz porte sur les fractions.

Privilégie les questions de niveau 5e portant sur :
- représentation d'une fraction ;
- partie d'un tout ;
- fractions équivalentes ;
- simplification ;
- comparaison simple ;
- addition ou soustraction simple de fractions lorsque le niveau le permet.

Si la question demande une fraction, utilise answerType = "fraction".

Exemple :

Une pastèque est divisée en 8 parts égales.
Koffi en donne 5.
Quelle fraction de la pastèque lui reste-t-il ?

La réponse correcte est :

3/8

Vérifie toujours le calcul avant de produire correctAnswer.
`
    : ""
}

RÈGLES POUR LES MATHÉMATIQUES

${
  isMath
    ? `
- Effectue réellement le calcul.
- Vérifie le résultat une deuxième fois.
- Ne permute jamais numérateur et dénominateur.
- Ne transforme jamais 3/5 en 5/3.
- Si plusieurs écritures sont équivalentes, donne comme correctAnswer une forme mathématiquement correcte.
`
    : ""
}

CONTEXTE IVOIRIEN

Lorsque cela est naturel, utilise des situations proches de la vie quotidienne en Côte d'Ivoire :
marché, école, famille, repas, fruits, argent en FCFA, quartiers ou villes.

Ne force cependant pas le contexte ivoirien lorsque cela rend la question artificielle.

QUESTIONS DÉJÀ POSÉES

${previousQuestions}

IMPORTANT

Retourne UNIQUEMENT le JSON.
Aucun texte avant le JSON.
Aucun texte après le JSON.
`;

  return callGeminiWithFallback(
    apiKey,
    prompt
  );
}

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
    question.answerType ===
    "qcm"
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
    question.answerType ===
    "fraction"
  ) {
    output +=
      "\n✍️ Écris ta réponse sous forme de fraction, par exemple 3/4.";
  }

  if (
    question.answerType ===
    "number"
  ) {
    output +=
      "\n✍️ Écris simplement le nombre demandé.";
  }

  return output;
}

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
    question.answerType ===
    "qcm"
  ) {
    return (
      normalizeChoice(answer) ===
      normalizeChoice(
        question.correctAnswer
      )
    );
  }

  if (
    question.answerType ===
    "fraction"
  ) {
    return fractionsEqual(
      answer,
      question.correctAnswer
    );
  }

  if (
    question.answerType ===
    "number"
  ) {
    return numbersEqual(
      answer,
      question.correctAnswer
    );
  }

  return false;
}

function makeQuizState({
  topic,
  question,
  questionNumber,
  score,
  askedQuestions,
  difficulty
}) {
  return {
    active: true,

    topic:
      topic ||
      "Quiz scolaire",

    totalQuestions:
      TOTAL_QUESTIONS,

    questionNumber,

    score,

    difficulty:
      difficulty ||
      "normal",

    askedQuestions,

    currentQuestion: {
      questionId:
        question.questionId,

      questionText:
        question.questionText,

      answerType:
        question.answerType,

      choices:
        question.choices,

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

function getNextDifficulty(
  currentDifficulty,
  isCorrect,
  score,
  questionNumber
) {
  const current =
    currentDifficulty ||
    "normal";

  const ratio =
    questionNumber > 0
      ? score / questionNumber
      : 0;

  if (
    isCorrect &&
    ratio >= 0.7
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

  return text
    .replace(
      /fais-moi|fais moi|donne-moi|donne moi|un quiz|un qcm|quiz|qcm/gi,
      ""
    )
    .trim();
}

function isQuizStartMessage(
  message
) {
  const text =
    normalizeText(message);

  return (
    text.includes("quiz") ||
    text.includes("qcm") ||
    text.includes(
      "teste-moi"
    ) ||
    text.includes(
      "teste moi"
    ) ||
    text.includes(
      "nouveau quiz"
    ) ||
    text.includes(
      "recommence le quiz"
    ) ||
    text.includes(
      "recommencer le quiz"
    )
  );
}

function formatCorrection(
  question,
  studentAnswer,
  isCorrect,
  scoreAfter,
  questionNumber
) {
  let output =
    isCorrect
      ? "### ✅ Bonne réponse !\n\n"
      : "### ❌ Ce n'est pas la bonne réponse.\n\n";

  output +=
    `**Ta réponse :** ${studentAnswer}\n\n`;

  if (
    question.answerType ===
    "qcm"
  ) {
    const index =
      ["A", "B", "C", "D"].indexOf(
        question.correctAnswer
      );

    const correctText =
      index >= 0
        ? question.choices[index]
        : "";

    output +=
      `**Bonne réponse :** ${question.correctAnswer}. ${correctText}\n\n`;
  }

  if (
    question.answerType ===
    "fraction"
  ) {
    output +=
      `**Bonne réponse :** ${formatFraction(
        question.correctAnswer
      )}\n\n`;
  }

  if (
    question.answerType ===
    "number"
  ) {
    output +=
      `**Bonne réponse :** ${question.correctAnswer}\n\n`;
  }

  output +=
    `${question.explanation}\n\n`;

  output +=
    `**Score actuel : ${scoreAfter}/${questionNumber}**`;

  return output;
}

export default async function handler(
  req,
  res
) {
  if (req.method !== "POST") {
    return res.status(405).json({
      error:
        "Méthode non autorisée."
    });
  }

  try {
    const {
      action = "",
      message = "",
      grade = "",
      subject = "",
      serie = "",
      difficulty = "",
      quizState = null
    } = req.body || {};

    const apiKey =
      process.env.GEMINI_API_KEY;

    if (!apiKey) {
      return res.status(500).json({
        error:
          "La clé API Gemini n'est pas configurée sur Vercel."
      });
    }

    /*
     * ==========================================
     * DÉMARRAGE DU QUIZ
     * ==========================================
     */

    if (
      action === "start" ||
      isQuizStartMessage(message)
    ) {
      const topic =
        extractTopic(message) ||
        subject;

      const initialDifficulty =
        difficulty === "simple"
          ? "facile"
          : difficulty ===
            "détaillé"
          ? "normal"
          : "normal";

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

      const quiz =
        makeQuizState({
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

      return res.status(200).json({
        answer:
          `🎯 **Quiz Klasévia — ${topic}**\n\n` +
          formatQuestion(
            question,
            1
          ),

        quizState: quiz
      });
    }

    /*
     * ==========================================
     * RÉPONSE À UNE QUESTION
     * ==========================================
     */

    if (
      action === "answer" &&
      quizState?.active &&
      quizState?.currentQuestion
    ) {
      const currentQuestion =
        quizState.currentQuestion;

      const isCorrect =
        gradeAnswer(
          currentQuestion,
          message
        );

      const previousScore =
        Number(
          quizState.score || 0
        );

      const currentNumber =
        Number(
          quizState.questionNumber ||
            1
        );

      const newScore =
        previousScore +
        (isCorrect ? 1 : 0);

      /*
       * ========================================
       * FIN DU QUIZ
       * ========================================
       */

      if (
        currentNumber >=
        TOTAL_QUESTIONS
      ) {
        const percentage =
          Math.round(
            (newScore /
              TOTAL_QUESTIONS) *
              100
          );

        const finalQuiz = {
          ...quizState,
          active: false,
          score: newScore,
          questionNumber:
            currentNumber,
          currentQuestion: null,
          finalScore: newScore,
          completedAt:
            new Date().toISOString()
        };

        let appreciation;

        if (percentage >= 80) {
          appreciation =
            "Excellent travail ! Tu maîtrises très bien cette notion. 🎉";
        } else if (
          percentage >= 60
        ) {
          appreciation =
            "Bon travail ! Quelques révisions supplémentaires te permettront encore de progresser.";
        } else {
          appreciation =
            "Ce n'est pas grave. Nous allons reprendre les notions qui posent difficulté et progresser étape par étape.";
        }

        const finalAnswer =
          formatCorrection(
            currentQuestion,
            message,
            isCorrect,
            newScore,
            currentNumber
          ) +
          `\n\n## 🏁 Quiz terminé !\n\n` +
          `**Résultat : ${newScore}/${TOTAL_QUESTIONS} (${percentage} %).**\n\n` +
          appreciation;

        return res.status(200).json({
          answer:
            finalAnswer,

          quizState:
            finalQuiz
        });
      }

      /*
       * ========================================
       * GÉNÉRATION DE LA QUESTION SUIVANTE
       * ========================================
       */

      const nextDifficulty =
        getNextDifficulty(
          quizState.difficulty,
          isCorrect,
          newScore,
          currentNumber
        );

      const askedQuestions =
        Array.isArray(
          quizState.askedQuestions
        )
          ? quizState.askedQuestions
          : [];

      const nextQuestion =
        await generateQuestion({
          apiKey,
          grade,
          subject,
          serie,
          topic:
            quizState.topic ||
            subject,
          difficulty:
            nextDifficulty,
          questionNumber:
            currentNumber + 1,
          score: newScore,
          askedQuestions
        });

      const nextState =
        makeQuizState({
          topic:
            quizState.topic ||
            subject,

          question:
            nextQuestion,

          questionNumber:
            currentNumber + 1,

          score:
            newScore,

          askedQuestions: [
            ...askedQuestions,
            nextQuestion.questionText
          ].slice(-10),

          difficulty:
            nextDifficulty
        });

      const correction =
        formatCorrection(
          currentQuestion,
          message,
          isCorrect,
          newScore,
          currentNumber
        );

      const nextQuestionText =
        `\n\n---\n\n` +
        formatQuestion(
          nextQuestion,
          currentNumber + 1
        );

      return res.status(200).json({
        answer:
          correction +
          nextQuestionText,

        quizState:
          nextState
      });
    }

    return res.status(400).json({
      error:
        "État du quiz invalide. Demande un nouveau quiz pour recommencer."
    });
  } catch (error) {
    console.error(
      "Erreur API Quiz :",
      error
    );

    return res.status(500).json({
      error:
        error?.message ||
        "Une erreur interne est survenue dans le moteur du quiz."
    });
  }
}