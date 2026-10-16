const MODELS = [
  "gemini-3.5-flash-lite",
  "gemini-3.6-flash",
  "gemini-3.8-flash"
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
      minItems: 0,
      maxItems: 4,
      description:
        "Quatre choix uniquement pour un QCM. Tableau vide pour fraction ou nombre."
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
   OUTILS FRACTIONS
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

/* =========================================================
   OUTILS NOMBRES
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
    Math.abs(first - second) <
    0.000001
  );
}

/* =========================================================
   OUTILS QCM
   ========================================================= */

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
   VALIDATION QUESTION
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
        String(choice || "").trim()
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
    question.answerType ===
    "fraction"
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

    question.correctAnswer =
      String(
        question.correctAnswer
      ).trim();
  }

  question.questionId =
    String(
      question.questionId
    ).trim();

  question.questionText =
    String(
      question.questionText
    ).trim();

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
   APPEL GEMINI AVEC RETRY + FALLBACK
   ========================================================= */

function sleep(ms) {
  return new Promise(resolve =>
    setTimeout(resolve, ms)
  );
}

async function callGeminiJson(
  apiKey,
  prompt
) {
  let lastError = null;

  /*
   * On essaie chaque modèle.
   *
   * Pour chaque modèle :
   * 1. tentative immédiate
   * 2. nouvelle tentative après 800 ms
   * 3. nouvelle tentative après 1600 ms
   *
   * Si le modèle continue à répondre 503,
   * on passe automatiquement au modèle suivant.
   */

  for (const model of MODELS) {
    for (
      let attempt = 0;
      attempt < 3;
      attempt++
    ) {
      try {
        if (attempt > 0) {
          const delay =
            attempt === 1
              ? 800
              : 1600;

          await sleep(delay);
        }

        const response =
          await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(
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
                      model ===
                      "gemini-3.5-flash-lite"
                        ? "minimal"
                        : "medium"
                  },
                  maxOutputTokens: 3000
                }
              })
            }
          );

        if (response.ok) {
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
              `Le modèle ${model} n'a pas généré de contenu exploitable.`
            );
          }

          let parsed;

          try {
            parsed =
              JSON.parse(raw);
          } catch (error) {
            console.error(
              `JSON invalide avec ${model} :`,
              raw
            );

            throw new Error(
              `Le modèle ${model} a produit un JSON invalide.`
            );
          }

          return validateQuestion(
            parsed
          );
        }

        const errorText =
          await response.text();

        console.error(
          `Gemini ${model} — HTTP ${response.status} :`,
          errorText
        );

        /*
         * Les erreurs 503 et 429 sont
         * temporaires : on retente.
         *
         * Les autres erreurs sont généralement
         * des erreurs de configuration ou de requête.
         */
        if (
          response.status !== 503 &&
          response.status !== 429
        ) {
          throw new Error(
            `Gemini ${model} a répondu avec HTTP ${response.status}.`
          );
        }

        lastError =
          new Error(
            `Gemini ${model} temporairement indisponible (${response.status}).`
          );
      } catch (error) {
        lastError = error;

        console.error(
          `Tentative Gemini échouée avec ${model} :`,
          error
        );

        /*
         * On continue automatiquement.
         */
      }
    }

    console.warn(
      `Modèle ${model} indisponible. Passage au modèle suivant.`
    );
  }

  throw (
    lastError ||
    new Error(
      "Tous les modèles Gemini sont temporairement indisponibles."
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
    )
      ? askedQuestions
          .slice(-8)
          .map(
            (item, index) =>
              `${index + 1}. ${item}`
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
Tu es le moteur officiel de génération des quiz de Klasévia.

Niveau scolaire : ${grade}
Matière : ${subject}
Série : ${serie || "Non précisée"}
Thème : ${
    topic ||
    "à déterminer à partir de la matière"
  }
Difficulté : ${
    difficulty || "normal"
  }
Numéro de question : ${questionNumber}
Score actuel : ${score}

MISSION

Génère UNE SEULE question de quiz.

RÈGLES ABSOLUES

1. La question doit correspondre exactement au niveau scolaire.
2. Elle doit correspondre exactement à la matière.
3. Elle doit correspondre au thème demandé.
4. Elle doit avoir une seule réponse correcte.
5. Elle ne doit être ni ambiguë ni piégeuse.
6. Elle ne doit pas répéter une question précédente.
7. Vérifie le calcul avant de produire le JSON.
8. Vérifie encore une deuxième fois la valeur de correctAnswer.
9. L'explication doit être mathématiquement et pédagogiquement correcte.
10. N'utilise jamais une réponse approximative lorsqu'une réponse exacte est attendue.
11. Ne mets jamais la réponse dans questionText.
12. Ne produis aucun texte en dehors du JSON.

TYPES DISPONIBLES

QCM :
- answerType = "qcm"
- exactement quatre choix
- correctAnswer = A, B, C ou D

FRACTION :
- answerType = "fraction"
- choices = []
- correctAnswer = une fraction a/b

NOMBRE :
- answerType = "number"
- choices = []
- correctAnswer = un nombre

MATHÉMATIQUES

Vérifie tous les calculs.

Ne permute jamais le numérateur et le dénominateur.

Lorsqu'une fraction est demandée :
- utilise le format a/b ;
- vérifie la valeur exacte ;
- accepte conceptuellement les fractions équivalentes ;
- ne donne pas une fraction inversée.

${
  mathSubject && fractionTopic
    ? `
CAS PARTICULIER :

Le quiz porte sur les fractions.

Privilégie answerType = "fraction"
lorsque l'élève doit calculer ou identifier une fraction.

Exemple :

Une tablette est divisée en 4 parts égales.
Un élève mange 3 parts.
Quelle fraction de la tablette a-t-il mangée ?

La réponse correcte est :

3/4

Ne jamais produire 4/3 dans ce cas.
`
    : ""
}

QUESTIONS DÉJÀ POSÉES

${previousQuestions}

RÉPONSE

Retourne uniquement l'objet JSON correspondant au schéma.
`;

  return callGeminiJson(
    apiKey,
    prompt
  );
}

/* =========================================================
   AFFICHAGE DES FRACTIONS
   ========================================================= */

function formatFraction(value) {
  const fraction =
    parseFraction(value);

  if (!fraction) {
    return String(value || "");
  }

  return `${fraction.numerator}/${fraction.denominator}`;
}

/* =========================================================
   AFFICHAGE QUESTION
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

/* =========================================================
   CORRECTION
   ========================================================= */

function formatCorrection(
  question,
  studentAnswer,
  isCorrect,
  scoreAfter,
  questionNumber
) {
  let output = isCorrect
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

    const correctChoice =
      index >= 0
        ? question.choices[index]
        : "";

    output +=
      `**Bonne réponse :** ${question.correctAnswer}. ${correctChoice}\n\n`;
  } else if (
    question.answerType ===
    "fraction"
  ) {
    output +=
      `**Bonne réponse :** ${formatFraction(
        question.correctAnswer
      )}\n\n`;
  } else {
    output +=
      `**Bonne réponse :** ${question.correctAnswer}\n\n`;
  }

  if (question.explanation) {
    output +=
      `${question.explanation}\n\n`;
  }

  output +=
    `**Score : ${scoreAfter}/${questionNumber}**`;

  return output;
}

/* =========================================================
   CORRECTION AUTOMATIQUE
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
  difficulty,
  grade,
  subject,
  serie
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

    grade: grade || "",

    subject: subject || "",

    serie: serie || "",

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
   ADAPTATION DIFFICULTÉ
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
   DÉTECTION QUIZ
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
          "La clé API Gemini n'est pas configurée sur Vercel."
      });
    }

    /* =====================================================
       DÉMARRAGE
       ===================================================== */

    if (
      action === "start" ||
      isQuizStartMessage(message)
    ) {
      const topic =
        extractTopic(message) ||
        subject ||
        "quiz scolaire";

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
            initialDifficulty,

          grade,

          subject,

          serie
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

      const correctionQuestion =
        {
          ...currentQuestion,

          questionNumber:
            currentNumber
        };

      /* ===================================================
         FIN
         =================================================== */

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
          formatCorrection(
            correctionQuestion,

            message,

            isCorrect,

            newScore,

            currentNumber
          ) +
          `\n\n## 🏁 Quiz terminé !\n\n` +
          `**Résultat : ${newScore}/${TOTAL_QUESTIONS} (${percentage} %).**\n\n` +
          `${
            percentage >= 80
              ? "Excellent travail ! Tu maîtrises très bien cette notion. 🎉"
              : percentage >= 60
              ? "Bon travail ! Quelques révisions supplémentaires te permettront de progresser encore."
              : "Ce n'est pas grave. Reprenons les notions qui posent difficulté et progressons étape par étape."
          }`;

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

          grade:
            quizState.grade ||
            grade,

          subject:
            quizState.subject ||
            subject,

          serie:
            quizState.serie ||
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
            nextDifficulty,

          grade:
            quizState.grade ||
            grade,

          subject:
            quizState.subject ||
            subject,

          serie:
            quizState.serie ||
            serie
        });

      const correction =
        formatCorrection(
          correctionQuestion,

          message,

          isCorrect,

          newScore,

          currentNumber
        );

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