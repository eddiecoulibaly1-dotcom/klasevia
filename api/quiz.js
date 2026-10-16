const PRIMARY_MODEL = "gemini-3.6-flash";
const FALLBACK_MODEL = "gemini-3.5-flash-lite";

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
      minItems: 0,
      maxItems: 4,
      description:
        "Quatre choix pour un QCM. Tableau vide pour fraction ou nombre."
    },
    correctAnswer: {
      type: "string",
      description:
        "Réponse correcte. Pour QCM : A, B, C ou D. Pour fraction : a/b. Pour nombre : valeur numérique."
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


/* =========================================================
   OUTILS DE NORMALISATION
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
    /^(-?\d+)\/(-?\d+)$/
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

  if (
    first === null ||
    second === null
  ) {
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
      "Énoncé de question vide."
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

  if (
    question.answerType === "qcm"
  ) {
    if (
      question.choices.length !== 4
    ) {
      throw new Error(
        "Un QCM doit contenir exactement quatre choix."
      );
    }

    question.choices =
      question.choices.map(choice =>
        String(choice).trim()
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
        "La bonne réponse du QCM doit être A, B, C ou D."
      );
    }

    question.correctAnswer =
      correctChoice;
  }

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
        "La fraction correcte est invalide."
      );
    }

    question.correctAnswer =
      formatFraction(
        question.correctAnswer
      );
  }

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
        "La réponse numérique est invalide."
      );
    }
  }

  if (
    !["facile", "normal", "difficile"].includes(
      question.difficulty
    )
  ) {
    question.difficulty = "normal";
  }

  question.questionId =
    question.questionId.trim();

  question.questionText =
    question.questionText.trim();

  question.explanation =
    String(
      question.explanation || ""
    ).trim();

  if (!question.explanation) {
    question.explanation =
      "Revérifions cette réponse étape par étape.";
  }

  return question;
}


/* =========================================================
   APPEL GEMINI
========================================================= */

async function callGeminiModel(
  apiKey,
  model,
  prompt
) {
  const url =
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;

  const response =
    await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type":
          "application/json",
        "x-goog-api-key": apiKey
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
              model === PRIMARY_MODEL
                ? "medium"
                : "minimal"
          },

          maxOutputTokens: 3000
        }
      })
    });

  const rawResponse =
    await response.text();

  if (!response.ok) {
    let details = rawResponse;

    try {
      const parsed =
        JSON.parse(rawResponse);

      details =
        parsed?.error?.message ||
        parsed?.error?.status ||
        rawResponse;
    } catch {
      // On conserve la réponse brute.
    }

    const error =
      new Error(
        `Gemini ${model} HTTP ${response.status}: ${details}`
      );

    error.status =
      response.status;

    error.model = model;

    throw error;
  }

  let data;

  try {
    data =
      JSON.parse(rawResponse);
  } catch {
    throw new Error(
      `Gemini ${model} a renvoyé une réponse JSON invalide.`
    );
  }

  const raw =
    data?.candidates?.[0]
      ?.content?.parts
      ?.map(part =>
        part?.text || ""
      )
      .join("")
      .trim();

  if (!raw) {
    throw new Error(
      `Gemini ${model} n'a généré aucune question exploitable.`
    );
  }

  let parsed;

  try {
    parsed = JSON.parse(raw);
  } catch {
    console.error(
      `JSON invalide reçu de ${model}:`,
      raw
    );

    throw new Error(
      `Gemini ${model} a produit un JSON inexploitable.`
    );
  }

  return validateQuestion(
    parsed
  );
}


/* =========================================================
   APPEL AVEC SECOURS AUTOMATIQUE
========================================================= */

async function callGeminiJson(
  apiKey,
  prompt
) {
  try {
    return await callGeminiModel(
      apiKey,
      PRIMARY_MODEL,
      prompt
    );
  } catch (primaryError) {
    console.error(
      "Échec Gemini principal :",
      primaryError
    );

    /*
     * On utilise le modèle de secours
     * uniquement lorsque le problème est
     * susceptible d'être temporaire.
     *
     * Une erreur HTTP 400 indique généralement
     * un problème dans la requête et ne doit pas
     * être masquée par un second appel identique.
     */

    const status =
      primaryError?.status;

    const shouldFallback =
      status === 429 ||
      status === 500 ||
      status === 502 ||
      status === 503 ||
      status === 504;

    if (!shouldFallback) {
      throw primaryError;
    }

    try {
      console.log(
        `Tentative de secours avec ${FALLBACK_MODEL}`
      );

      return await callGeminiModel(
        apiKey,
        FALLBACK_MODEL,
        prompt
      );
    } catch (fallbackError) {
      console.error(
        "Échec Gemini de secours :",
        fallbackError
      );

      throw new Error(
        `Les deux moteurs Gemini sont momentanément indisponibles. Principal : ${primaryError.message} | Secours : ${fallbackError.message}`
      );
    }
  }
}


/* =========================================================
   GÉNÉRATION D'UNE QUESTION
========================================================= */

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
    Array.isArray(askedQuestions) &&
    askedQuestions.length > 0
      ? askedQuestions
          .slice(-10)
          .map(
            (item, index) =>
              `${index + 1}. ${item}`
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

Niveau scolaire : ${grade}
Matière : ${subject}
Série : ${serie || "Non précisée"}
Thème : ${topic || subject}
Difficulté : ${difficulty || "normal"}
Numéro de question : ${questionNumber}
Score actuel : ${score}

Tu dois générer UNE SEULE question.

RÈGLES OBLIGATOIRES :

1. Respecte strictement le niveau scolaire.
2. Respecte strictement la matière.
3. Respecte strictement le thème demandé.
4. La question doit avoir UNE réponse déterminée.
5. Ne crée aucune ambiguïté.
6. Ne répète aucune question déjà posée.
7. Utilise un contexte ivoirien lorsque cela est naturel.
8. Vérifie mathématiquement la réponse avant de produire le JSON.
9. La valeur correctAnswer doit être exactement correcte.
10. L'explication doit être correcte.
11. Ne mets pas la réponse dans questionText.
12. Ne mets aucun Markdown dans les valeurs JSON.
13. Ne donne aucune réponse approximative lorsqu'une réponse exacte est attendue.

TYPES AUTORISÉS :

QCM :
- answerType = "qcm"
- exactement quatre choix
- correctAnswer = A, B, C ou D

FRACTION :
- answerType = "fraction"
- choices = []
- correctAnswer sous la forme a/b
- les fractions équivalentes devront être acceptées par le moteur local

NOMBRE :
- answerType = "number"
- choices = []
- correctAnswer doit être numérique

${
  isMath && isFraction
    ? `
CAS PARTICULIER IMPORTANT :

Le thème porte sur les fractions.

Privilégie les questions de niveau ${grade}
sur :
- représentation d'une fraction ;
- fraction d'une quantité ;
- fractions équivalentes ;
- comparaison de fractions ;
- simplification ;
- addition ou soustraction lorsque adaptée au niveau.

Vérifie TOUJOURS le calcul.

Exemple :

Une tablette est divisée en 4 parts égales.
Un élève mange 3 parts.
Quelle fraction de la tablette a-t-il mangée ?

La bonne réponse est :
3/4

correctAnswer doit être :
"3/4"
`
    : ""
}

QUESTIONS DÉJÀ POSÉES :

${previousQuestions}

Réponds UNIQUEMENT avec l'objet JSON demandé par le schéma.
`;

  return callGeminiJson(
    apiKey,
    prompt
  );
}


/* =========================================================
   AFFICHAGE D'UNE QUESTION
========================================================= */

function formatQuestion(
  question,
  questionNumber
) {
  let output =
    `## Question ${questionNumber}/${TOTAL_QUESTIONS}\n\n`;

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


/* =========================================================
   CORRECTION LOCALE
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


/* =========================================================
   AFFICHAGE DE LA BONNE RÉPONSE
========================================================= */

function displayCorrectAnswer(
  question
) {
  if (
    question.answerType ===
    "qcm"
  ) {
    const index =
      question.correctAnswer
        .charCodeAt(0) - 65;

    const choice =
      question.choices?.[index] ||
      "";

    return `${question.correctAnswer}. ${choice}`;
  }

  if (
    question.answerType ===
    "fraction"
  ) {
    return formatFraction(
      question.correctAnswer
    );
  }

  return question.correctAnswer;
}


/* =========================================================
   CORRECTION PÉDAGOGIQUE
========================================================= */

function formatCorrection({
  question,
  studentAnswer,
  isCorrect,
  scoreAfter,
  questionNumber
}) {
  let output =
    isCorrect
      ? "### ✅ Bonne réponse !\n\n"
      : "### ❌ Ce n'est pas la bonne réponse.\n\n";

  output +=
    `**Ta réponse :** ${studentAnswer}\n\n`;

  if (!isCorrect) {
    output +=
      `**Bonne réponse :** ${displayCorrectAnswer(
        question
      )}\n\n`;
  }

  output +=
    `${question.explanation}\n\n`;

  output +=
    `**Score : ${scoreAfter}/${questionNumber}**`;

  return output;
}


/* =========================================================
   DIFFICULTÉ ADAPTATIVE
========================================================= */

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


/* =========================================================
   ÉTAT DU QUIZ
========================================================= */

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

    /*
     * IMPORTANT :
     * Le frontend utilise "total".
     */
    total:
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

  return text
    .replace(
      /fais-moi|fais moi|donne-moi|donne moi|un quiz|un qcm|quiz|qcm/gi,
      ""
    )
    .trim();
}


/* =========================================================
   HANDLER VERCEL
========================================================= */

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


    /* =====================================================
       DÉMARRAGE
    ===================================================== */

    if (action === "start") {
      const topic =
        extractTopic(message) ||
        subject ||
        "quiz scolaire";

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


    /* =====================================================
       RÉPONSE
    ===================================================== */

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


      /* ===================================================
         FIN DU QUIZ
      =================================================== */

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

        const correction =
          formatCorrection({
            question:
              currentQuestion,

            studentAnswer:
              message,

            isCorrect,

            scoreAfter:
              newScore,

            questionNumber:
              currentNumber
          });

        let appreciation =
          "";

        if (
          percentage >= 80
        ) {
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

        const finalQuiz = {
          ...quizState,

          active: false,

          total:
            TOTAL_QUESTIONS,

          score:
            newScore,

          questionNumber:
            currentNumber,

          currentQuestion:
            null,

          finalScore:
            newScore,

          completedAt:
            new Date().toISOString()
        };

        return res.status(200).json({
          answer:
            `${correction}\n\n` +
            `## 🏁 Quiz terminé !\n\n` +
            `**Résultat : ${newScore}/${TOTAL_QUESTIONS} (${percentage} %).**\n\n` +
            appreciation,

          quizState:
            finalQuiz
        });
      }


      /* ===================================================
         QUESTION SUIVANTE
      =================================================== */

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

          score:
            newScore,

          askedQuestions
        });

      const nextQuestionNumber =
        currentNumber + 1;

      const nextState =
        makeQuizState({
          topic:
            quizState.topic ||
            subject,

          question:
            nextQuestion,

          questionNumber:
            nextQuestionNumber,

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
        formatCorrection({
          question:
            currentQuestion,

          studentAnswer:
            message,

          isCorrect,

          scoreAfter:
            newScore,

          questionNumber:
            currentNumber
        });

      return res.status(200).json({
        answer:
          `${correction}\n\n` +
          `---\n\n` +
          formatQuestion(
            nextQuestion,
            nextQuestionNumber
          ),

        quizState:
          nextState
      });
    }


    /* =====================================================
       ÉTAT INVALIDE
    ===================================================== */

    return res.status(400).json({
      error:
        "État du quiz invalide. Demande un nouveau quiz pour recommencer."
    });

  } catch (error) {
    console.error(
      "ERREUR API QUIZ :",
      error
    );

    return res.status(500).json({
      error:
        error?.message ||
        "Une erreur interne est survenue dans le moteur du quiz."
    });
  }
}