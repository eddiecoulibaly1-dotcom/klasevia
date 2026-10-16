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
        "Réponse correcte. Pour QCM: A, B, C ou D. Pour fraction: a/b. Pour nombre: valeur numérique."
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


/* =========================================================
   VALIDATION DE LA QUESTION
   ========================================================= */

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

    question.choices =
      question.choices.map(
        choice => String(choice).trim()
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

  question.questionText =
    String(question.questionText).trim();

  question.explanation =
    String(
      question.explanation || ""
    ).trim();

  question.difficulty =
    ["facile", "normal", "difficile"].includes(
      question.difficulty
    )
      ? question.difficulty
      : "normal";

  return question;
}


/* =========================================================
   APPEL GEMINI
   ========================================================= */

/*
 * IMPORTANT :
 *
 * Nous utilisons ici la syntaxe generateContent compatible
 * avec Gemini 3.6 Flash et Gemini 3.5 Flash-Lite.
 *
 * Nous n'utilisons PAS :
 *
 * responseFormat: {
 *   text: {
 *     mimeType: "application/json"
 *   }
 * }
 *
 * C'est cette ancienne structure qui provoquait
 * l'erreur HTTP 400 observée dans Klasévia.
 */

async function callGeminiJson(
  apiKey,
  prompt
) {
  let lastError = null;

  for (const model of MODELS) {
    try {
      const url =
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;

      const response =
        await fetch(url, {
          method: "POST",
          headers: {
            "Content-Type":
              "application/json",
            "x-goog-api-key":
              apiKey
          },
          body: JSON.stringify({
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

              responseSchema:
                QUESTION_SCHEMA,

              maxOutputTokens: 2048
            }
          })
        });

      if (!response.ok) {
        const errorText =
          await response.text();

        console.error(
          `Erreur Gemini ${model}:`,
          errorText
        );

        lastError =
          new Error(
            `Gemini ${model} HTTP ${response.status}`
          );

        continue;
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
        lastError =
          new Error(
            `Gemini ${model} n'a produit aucun contenu.`
          );

        continue;
      }

      let parsed;

      try {
        parsed =
          JSON.parse(raw);
      } catch (error) {
        console.error(
          `JSON invalide produit par ${model}:`,
          raw
        );

        lastError =
          new Error(
            `Réponse JSON invalide de ${model}.`
          );

        continue;
      }

      try {
        return validateQuestion(
          parsed
        );
      } catch (error) {
        console.error(
          `Question invalide produite par ${model}:`,
          error
        );

        lastError =
          error;

        continue;
      }

    } catch (error) {
      console.error(
        `Erreur réseau Gemini ${model}:`,
        error
      );

      lastError =
        error;
    }
  }

  throw (
    lastError ||
    new Error(
      "Tous les modèles Gemini sont indisponibles."
    )
  );
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
    Array.isArray(
      askedQuestions
    ) &&
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
Tu es le moteur officiel de génération des quiz
de l'application éducative Klasévia.

INFORMATIONS DU QUIZ

Niveau scolaire : ${grade || "non précisé"}
Matière : ${subject || "non précisée"}
Série : ${serie || "Non précisée"}
Thème : ${topic || subject || "non précisé"}
Difficulté : ${difficulty || "normal"}
Numéro de question : ${questionNumber}
Score actuel : ${score}

MISSION

Génère UNE SEULE question.

La question doit être adaptée au niveau scolaire,
à la matière et au thème demandés.

RÈGLES OBLIGATOIRES

1. La question doit avoir UNE SEULE réponse correcte.

2. Elle doit être claire et sans ambiguïté.

3. Elle doit être adaptée au niveau indiqué.

4. Ne répète aucune question déjà posée.

5. Vérifie mathématiquement la réponse avant de
   produire le JSON.

6. Vérifie encore une deuxième fois le résultat
   avant de produire le JSON.

7. "correctAnswer" doit absolument être exact.

8. L'explication doit être cohérente avec la bonne réponse.

9. Ne mets aucune solution dans "questionText".

10. Réponds uniquement avec le JSON demandé.

TYPES DE QUESTIONS

TYPE qcm :
- exactement quatre choix ;
- choix A, B, C et D ;
- correctAnswer = A, B, C ou D.

TYPE fraction :
- l'élève doit écrire une fraction ;
- exemple : 3/4 ;
- correctAnswer doit être sous forme a/b ;
- les fractions équivalentes doivent être acceptées
  par le système de correction.

TYPE number :
- l'élève écrit un nombre ;
- correctAnswer doit être numérique.

RÈGLES SPÉCIALES POUR LES MATHÉMATIQUES

Si la matière concerne les mathématiques :

- calcule réellement la réponse ;
- ne permute jamais numérateur et dénominateur ;
- vérifie les additions, soustractions,
  multiplications et divisions ;
- vérifie les fractions ;
- ne donne jamais une réponse approximative
  lorsqu'une réponse exacte est attendue.

${
  isMath && isFraction
    ? `
RÈGLE SPÉCIALE FRACTIONS

Le thème est celui des fractions.

Privilégie le type "fraction"
lorsque la réponse attendue est une fraction.

Exemple :

Une tablette est divisée en 4 parts égales.
Un élève mange 3 parts.
Quelle fraction de la tablette a-t-il mangée ?

correctAnswer :
3/4

Une fraction équivalente comme 6/8 doit être
considérée correcte par le moteur.
`
    : ""
}

CONTEXTE

Lorsque cela est naturel, utilise des situations
proches de la vie quotidienne en Côte d'Ivoire :
école, marché, partage de nourriture,
argent en FCFA, transport, sport, etc.

QUESTIONS DÉJÀ POSÉES

${previousQuestions}

IMPORTANT

Ne génère qu'une seule question.

Retourne uniquement le JSON correspondant
au schéma fourni.
`;

  return callGeminiJson(
    apiKey,
    prompt
  );
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
      "\n✍️ Réponds simplement par A, B, C ou D.";
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


function formatCorrectAnswer(
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
  score
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

  if (!isCorrect) {
    output +=
      `**Bonne réponse :** ${formatCorrectAnswer(
        question
      )}\n\n`;
  }

  if (question.explanation) {
    output +=
      `${question.explanation}\n\n`;
  }

  output +=
    `**Score actuel : ${score}/${question.questionNumber}**`;

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
      normalizeChoice(
        question.correctAnswer
      )
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


function getNextDifficulty({
  currentDifficulty,
  isCorrect,
  score,
  questionNumber
}) {
  const current =
    currentDifficulty ||
    "normal";

  const ratio =
    questionNumber > 0
      ? score / questionNumber
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

  if (
    match?.[1]
  ) {
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
   DÉTECTION DU DÉMARRAGE
   ========================================================= */

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
          "La clé API Gemini n'est pas configurée dans Vercel."
      });
    }


    /* =====================================================
       DÉMARRER UN NOUVEAU QUIZ
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

        quizState:
          quiz
      });
    }


    /* =====================================================
       RÉPONDRE À UNE QUESTION
       ===================================================== */

    if (
      action === "answer"
    ) {
      if (
        !quizState ||
        !quizState.active ||
        !quizState.currentQuestion
      ) {
        return res.status(400).json({
          error:
            "Aucun quiz actif. Demande un nouveau quiz."
        });
      }

      const currentQuestion =
        quizState.currentQuestion;

      const currentNumber =
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
          currentQuestion,
          message
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

        const finalQuiz = {
          ...quizState,

          active: false,

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

        let appreciation;

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
            "Ce n'est pas grave. Nous allons pouvoir revoir les notions qui posent difficulté et progresser étape par étape.";
        }

        const finalMessage =
          formatCorrection({
            question:
              correctionQuestion,

            studentAnswer:
              message,

            isCorrect,

            score:
              newScore
          }) +

          `\n\n---\n\n` +

          `## 🏁 Quiz terminé !\n\n` +

          `### Résultat : ${newScore}/${TOTAL_QUESTIONS} (${percentage} %)\n\n` +

          appreciation;

        return res.status(200).json({
          answer:
            finalMessage,

          quizState:
            finalQuiz
        });
      }


      /* ===================================================
         QUESTION SUIVANTE
         =================================================== */

      const nextDifficulty =
        getNextDifficulty({
          currentDifficulty:
            quizState.difficulty,

          isCorrect,

          score:
            newScore,

          questionNumber:
            currentNumber
        });


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
        formatCorrection({
          question:
            correctionQuestion,

          studentAnswer:
            message,

          isCorrect,

          score:
            newScore
        });


      const next =
        `\n\n---\n\n` +
        formatQuestion(
          nextQuestion,
          currentNumber + 1
        );


      return res.status(200).json({
        answer:
          correction + next,

        quizState:
          nextState
      });
    }


    /* =====================================================
       ACTION INCONNUE
       ===================================================== */

    return res.status(400).json({
      error:
        "Action de quiz invalide."
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