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
      description: "Énoncé clair de la question en français."
    },
    answerType: {
      type: "string",
      enum: ["qcm", "fraction", "number"],
      description:
        "Type de réponse attendu. Utiliser fraction pour une réponse comme 3/4."
    },
    choices: {
      type: "array",
      items: {
        type: "string"
      },
      minItems: 0,
      maxItems: 4,
      description:
        "Quatre choix uniquement pour un QCM. Tableau vide pour fraction ou nombre."
    },
    correctAnswer: {
      type: "string",
      description:
        "Réponse correcte canonique. Pour QCM: A, B, C ou D. Pour fraction: par exemple 3/4. Pour nombre: par exemple 12."
    },
    explanation: {
      type: "string",
      description:
        "Explication pédagogique courte permettant de comprendre la réponse."
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
    const remainder = x % y;
    x = y;
    y = remainder;
  }

  return x || 1;
}

function parseFraction(value) {
  const text = String(value || "")
    .trim()
    .replace(/\s+/g, "");

  const match = text.match(
    /^(-?\d+)\s*\/\s*(-?\d+)$/
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

  const divisor = gcd(
    numerator,
    denominator
  );

  let n = numerator / divisor;
  let d = denominator / divisor;

  if (d < 0) {
    n *= -1;
    d *= -1;
  }

  return {
    numerator: n,
    denominator: d
  };
}

function fractionsEqual(a, b) {
  const first = parseFraction(a);
  const second = parseFraction(b);

  if (!first || !second) {
    return false;
  }

  return (
    first.numerator ===
      second.numerator &&
    first.denominator ===
      second.denominator
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

  return Math.abs(first - second) < 0.000001;
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
    ].includes(
      question.answerType
    )
  ) {
    throw new Error(
      "Type de réponse invalide."
    );
  }

  if (
    question.answerType ===
    "qcm"
  ) {
    if (
      !Array.isArray(
        question.choices
      ) ||
      question.choices.length !==
        4
    ) {
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

  if (
    question.answerType ===
    "fraction"
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
  }

  if (
    question.answerType ===
    "number"
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
  }

  return question;
}

async function callGeminiJson(
  apiKey,
  prompt
) {
  const response =
    await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${encodeURIComponent(
        apiKey
      )}`,
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
            responseFormat: {
              text: {
                mimeType:
                  "application/json",
                schema:
                  QUESTION_SCHEMA
              }
            },
            thinkingConfig: {
              thinkingLevel:
                "medium"
            },
            maxOutputTokens: 3000
          }
        })
      }
    );

  if (!response.ok) {
    const errorText =
      await response.text();

    console.error(
      "Erreur Gemini Quiz :",
      errorText
    );

    throw new Error(
      "Le service de génération du quiz est temporairement indisponible."
    );
  }

  const data =
    await response.json();

  const raw =
    data?.candidates?.[0]
      ?.content?.parts
      ?.map(part =>
        part.text || ""
      )
      .join("")
      .trim();

  if (!raw) {
    throw new Error(
      "Gemini n'a pas généré de question exploitable."
    );
  }

  let parsed;

  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    console.error(
      "JSON Quiz invalide :",
      raw
    );

    throw new Error(
      "La question générée n'est pas exploitable."
    );
  }

  return validateQuestion(
    parsed
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
    )
      ? askedQuestions
          .slice(-8)
          .map(
            (item, index) =>
              `${index + 1}. ${
                item
              }`
          )
          .join("\n")
      : "Aucune question précédente.";

  const mathSubject =
    normalizeText(
      subject
    ).includes("math");

  const fractionTopic =
    normalizeText(
      topic
    ).includes("fraction");

  const prompt = `
Tu es le moteur de génération du quiz de Klasévia.

Niveau scolaire : ${grade}
Matière : ${subject}
Série : ${serie || "Non précisée"}
Thème demandé : ${
    topic || "à déterminer à partir de la matière"
  }
Difficulté actuelle : ${
    difficulty || "normal"
  }
Question numéro : ${questionNumber}
Score actuel : ${score}

OBJECTIF

Génère UNE SEULE nouvelle question de quiz.

RÈGLES ABSOLUES :

1. La question doit être adaptée exactement au niveau scolaire indiqué.
2. Elle doit porter sur le thème demandé.
3. Ne répète pas une question déjà posée.
4. Utilise le contexte ivoirien lorsque cela est naturel.
5. Une question doit avoir une réponse parfaitement déterminée.
6. Ne crée jamais une question ambiguë.
7. Vérifie toi-même la bonne réponse avant de produire le JSON.
8. La valeur "correctAnswer" doit correspondre exactement à la bonne réponse.
9. L'explication doit être pédagogiquement correcte.
10. Ne mets jamais de solution contradictoire dans les choix.

TYPES DE QUESTIONS :

- qcm :
  exactement quatre choix.
  correctAnswer doit être A, B, C ou D.

- fraction :
  l'élève écrit lui-même une fraction comme 3/4.
  correctAnswer doit être une fraction sous la forme a/b.
  Les fractions équivalentes doivent être considérées comme correctes
  par le moteur de correction.

- number :
  l'élève écrit un nombre.
  Utilise ce type pour les calculs dont la réponse est numérique.

POUR LES MATHÉMATIQUES :

- vérifie réellement tous les calculs ;
- ne permute jamais numérateur et dénominateur ;
- pour une fraction, vérifie le résultat indépendamment ;
- évite les calculs inutilement complexes ;
- ne donne jamais une réponse approximative si une réponse exacte est attendue.

${
  mathSubject && fractionTopic
    ? `
IMPORTANT POUR CE QUIZ SUR LES FRACTIONS :

Privilégie le type "fraction" lorsque la question demande une fraction.
Exemple :
"Une tablette est divisée en 4 parts égales. Un élève en mange 3.
Quelle fraction de la tablette a-t-il mangée ?"

correctAnswer doit alors être :
"3/4"

L'élève pourra répondre :
"3/4"
ou une fraction équivalente si elle représente exactement la même valeur.
`
    : ""
}

QUESTIONS DÉJÀ POSÉES :

${previousQuestions}

Réponds UNIQUEMENT avec le JSON conforme au schéma demandé.
`;

  return callGeminiJson(
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
    `## Question ${questionNumber}/${TOTAL_QUESTIONS}\n\n`;

  output += `${question.questionText}\n\n`;

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

        output += `${letter}. ${choice}\n`;
      }
    );

    output +=
      "\n✍️ Écris simplement A, B, C ou D.";
  } else if (
    question.answerType ===
    "fraction"
  ) {
    output +=
      "\n✍️ Écris ta réponse sous forme de fraction, par exemple 3/4.";
  } else {
    output +=
      "\n✍️ Écris simplement le nombre demandé.";
  }

  return output;
}

function formatCorrection(
  question,
  studentAnswer,
  isCorrect,
  scoreAfter
) {
  let output =
    isCorrect
      ? "### ✅ Bonne réponse !\n\n"
      : "### ❌ Ce n'est pas la bonne réponse.\n\n";

  output += `**Ta réponse :** ${studentAnswer}\n\n`;

  if (
    question.answerType ===
    "qcm"
  ) {
    output += `**Bonne réponse :** ${question.correctAnswer}\n\n`;
  } else if (
    question.answerType ===
    "fraction"
  ) {
    output += `**Bonne réponse :** ${formatFraction(
      question.correctAnswer
    )}\n\n`;
  } else {
    output += `**Bonne réponse :** ${question.correctAnswer}\n\n`;
  }

  output += `${question.explanation}\n\n`;

  output += `**Score : ${scoreAfter}/${question.questionNumber || "?"}**`;

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
      question.correctAnswer
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

  return (
    normalizeText(answer) ===
    normalizeText(
      question.correctAnswer
    )
  );
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
      topic || "Quiz scolaire",
    totalQuestions:
      TOTAL_QUESTIONS,
    questionNumber,
    score,
    difficulty:
      difficulty || "normal",
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
          "La clé API Gemini n'est pas configurée."
      });
    }

    /*
     * DÉMARRAGE D'UN QUIZ
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
     * RÉPONSE À UNE QUESTION
     */
    if (
      action ===
        "answer" &&
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

      const correctionQuestion =
        {
          ...currentQuestion,
          questionNumber:
            currentNumber
        };

      /*
       * FIN DU QUIZ
       */
      if (
        currentNumber >=
        TOTAL_QUESTIONS
      ) {
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

        const percentage =
          Math.round(
            (newScore /
              TOTAL_QUESTIONS) *
              100
          );

        const finalMessage =
          `${formatCorrection(
            correctionQuestion,
            message,
            isCorrect,
            newScore
          )}\n\n` +
          `## 🏁 Quiz terminé !\n\n` +
          `**Résultat : ${newScore}/${TOTAL_QUESTIONS} (${percentage} %).**\n\n` +
          `${
            percentage >= 80
              ? "Excellent travail ! Tu maîtrises très bien cette notion. 🎉"
              : percentage >= 60
              ? "Bon travail ! Quelques révisions supplémentaires te permettront de progresser encore."
              : "Ce n'est pas grave. Nous allons pouvoir reprendre les notions qui posent difficulté et progresser étape par étape."
          }`;

        return res.status(200).json({
          answer:
            finalMessage,
          quizState:
            finalQuiz
        });
      }

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
          score: newScore,
          askedQuestions: [
            ...askedQuestions,
            nextQuestion.questionText
          ].slice(-10),
          difficulty:
            nextDifficulty
        });

      const correction =
        formatCorrection(
          correctionQuestion,
          message,
          isCorrect,
          newScore
        );

      const next =
        `\n\n---\n\n${formatQuestion(
          nextQuestion,
          currentNumber + 1
        )}`;

      return res.status(200).json({
        answer:
          correction + next,
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