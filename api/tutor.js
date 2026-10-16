export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({
      error: "Méthode non autorisée."
    });
  }

  try {
    const {
      message = "",
      grade = "",
      subject = "",
      serie = "",
      difficulty = "",
      history = [],
      mode = ""
    } = req.body || {};

    const apiKey = process.env.GEMINI_API_KEY;

    if (!apiKey) {
      return res.status(500).json({
        error: "La clé API Gemini n'est pas configurée."
      });
    }

    const normalizedMessage = String(message).toLowerCase().trim();

    const recentHistory = Array.isArray(history)
      ? history.slice(-16)
      : [];

    const historyText = recentHistory
      .map((item) => {
        const role = item.role === "user" ? "Élève" : "Klasévia";
        return `${role}: ${item.content || ""}`;
      })
      .join("\n");

    /*
     * Détection des intentions.
     */
    const isQuizRequest =
      mode === "quiz" ||
      normalizedMessage.includes("quiz") ||
      normalizedMessage.includes("qcm") ||
      normalizedMessage.includes("question à choix") ||
      normalizedMessage.includes("teste-moi") ||
      normalizedMessage.includes("test moi") ||
      normalizedMessage.includes("fais-moi un quiz") ||
      normalizedMessage.includes("fais moi un quiz");

    const isExercise =
      mode === "exercice" ||
      normalizedMessage.includes("exercice") ||
      normalizedMessage.includes("exercices") ||
      normalizedMessage.includes("entraînement") ||
      normalizedMessage.includes("entrainement");

    const isCorrection =
      mode === "correction" ||
      normalizedMessage.includes("corrige") ||
      normalizedMessage.includes("corriger") ||
      normalizedMessage.includes("correction") ||
      normalizedMessage.includes("ma réponse") ||
      normalizedMessage.includes("ma reponse");

    /*
     * Détermine si l'historique montre qu'une question de quiz
     * vient d'être posée et que le message actuel ressemble
     * à une réponse de l'élève.
     */
    const assistantMessages = recentHistory.filter(
      (item) => item.role === "assistant"
    );

    const lastAssistantMessage =
      assistantMessages.length > 0
        ? assistantMessages[assistantMessages.length - 1]?.content || ""
        : "";

    const hasPreviousQuizQuestion =
      lastAssistantMessage.toLowerCase().includes("question") ||
      lastAssistantMessage.toLowerCase().includes("quelle fraction") ||
      lastAssistantMessage.toLowerCase().includes("quelle est") ||
      lastAssistantMessage.toLowerCase().includes("choisis") ||
      lastAssistantMessage.toLowerCase().includes("a.") ||
      lastAssistantMessage.toLowerCase().includes("b.") ||
      lastAssistantMessage.toLowerCase().includes("c.") ||
      lastAssistantMessage.toLowerCase().includes("d.");

    const looksLikeShortAnswer =
      normalizedMessage.length <= 80 &&
      (
        /^[abcd]$/i.test(normalizedMessage) ||
        /^[abcd][\.\)]?$/i.test(normalizedMessage) ||
        /^\d+\s*\/\s*\d+$/.test(normalizedMessage) ||
        /^-?\d+([.,]\d+)?$/.test(normalizedMessage) ||
        /^[a-zàâçéèêëîïôûùüÿñæœ\s'-]{1,40}$/i.test(normalizedMessage)
      );

    const isQuizAnswer =
      !isQuizRequest &&
      hasPreviousQuizQuestion &&
      looksLikeShortAnswer;

    /*
     * Si le message est une réponse à une question précédente,
     * le mode quiz doit être conservé.
     */
    const isQuiz =
      isQuizRequest ||
      isQuizAnswer ||
      mode === "quiz";

    let mission = `
Tu es Klasévia, un tuteur scolaire intelligent conçu pour accompagner
les élèves en Côte d'Ivoire.

Niveau scolaire : ${grade || "non précisé"}
Matière : ${subject || "non précisée"}
Série : ${serie || "non précisée"}
Difficulté : ${difficulty || "non précisée"}

Tu réponds toujours en français clair, naturel et adapté au niveau scolaire
de l'élève.

RÈGLES GÉNÉRALES :

1. Adapte ton vocabulaire au niveau de l'élève.
2. Explique progressivement.
3. Encourage l'élève lorsqu'il réussit.
4. En cas d'erreur, explique sans décourager.
5. Pour les mathématiques, vérifie toujours les calculs.
6. Ne donne jamais un résultat mathématique non vérifié.
7. Utilise des exemples proches du contexte ivoirien lorsque cela est naturel.
8. Ne demande pas à nouveau une information que l'élève vient déjà de donner.
`;

    /*
     * MODE QUIZ
     */
    if (isQuiz) {
      if (isQuizAnswer) {
        mission += `

MODE : RÉPONSE À UNE QUESTION DE QUIZ

IMPORTANT :
Le message actuel de l'élève doit être interprété comme une réponse
à la dernière question de quiz posée par Klasévia.

NE recommence PAS le quiz.
NE demande PAS à l'élève de donner à nouveau sa réponse.
NE dis PAS que l'élève n'a pas répondu.

Tu dois :

1. Identifier la dernière question de quiz dans l'historique.
2. Identifier la réponse actuelle de l'élève.
3. Comparer cette réponse à la bonne réponse.
4. Dire clairement si la réponse est correcte ou incorrecte.
5. Expliquer brièvement le raisonnement.
6. Si la réponse est incorrecte, donner la bonne réponse.
7. Ensuite, proposer la question suivante du quiz.

La réponse actuelle de l'élève est :

"${message}"

Cette réponse doit être traitée comme une tentative de réponse,
même si elle est très courte, par exemple :
- A
- B
- C
- D
- 3/4
- 2/5
- 12
- 7,5

Ne demande jamais simplement de répéter la réponse.
`;
      } else {
        mission += `

MODE : CRÉATION OU POURSUITE D'UN QUIZ

Tu dois créer ou poursuivre un quiz scolaire.

Si l'élève vient de demander un quiz, commence directement par la première
question. Ne demande pas quel chapitre l'élève souhaite travailler si son
message contient déjà le thème.

Par exemple, si l'élève dit :
"Fais-moi un quiz de mathématiques niveau 5e sur les fractions",

tu dois immédiatement poser une première question sur les fractions niveau 5e.

RÈGLES :

1. Pose une seule question à la fois.
2. Pour un QCM, propose exactement quatre choix :
   A, B, C et D.
3. Une seule réponse doit être correcte dans un QCM à réponse unique.
4. Les mauvaises réponses doivent être plausibles.
5. Ne révèle pas la bonne réponse avant la tentative de l'élève.
6. Lorsque l'élève répond, corrige sa réponse.
7. Après la correction, propose une nouvelle question.
8. Adapte progressivement la difficulté.
9. Évite de répéter exactement les mêmes questions.
`;
      }

      mission += `

VALIDATION MATHÉMATIQUE OBLIGATOIRE

Pour toute question de mathématiques, tu dois vérifier le problème
toi-même avant de donner la correction.

Pour les fractions :

- le nombre du haut est le NUMÉRATEUR ;
- le nombre du bas est le DÉNOMINATEUR ;
- ne jamais inverser ces deux termes ;
- vérifie l'équivalence des fractions ;
- vérifie les simplifications ;
- vérifie les opérations ;
- vérifie toutes les propositions A, B, C et D.

EXEMPLE :

18/12

Numérateur = 18
Dénominateur = 12

PGCD(18,12) = 6

18 ÷ 6 = 3
12 ÷ 6 = 2

Donc :

18/12 = 3/2

Il est INTERDIT d'écrire que 12 est le numérateur
ou que 18 est le dénominateur.

Pour chaque calcul, le résultat mathématique vérifié doit avoir priorité
sur toute réponse préparée précédemment.
`;
    }

    /*
     * MODE EXERCICE
     */
    if (isExercise) {
      mission += `

MODE EXERCICE ACTIVÉ

Propose un exercice adapté au niveau de l'élève.

Types possibles :

- calcul ;
- problème ;
- réponse courte ;
- raisonnement ;
- compréhension ;
- sciences ;
- langues.

Présente un seul exercice à la fois.

Ne donne pas immédiatement la solution.

Attends la réponse de l'élève avant de corriger.

ADAPTATION :

- réussite claire : augmente légèrement la difficulté ;
- réussite partielle : reste au même niveau et consolide ;
- erreur : propose une difficulté légèrement plus accessible ;
- plusieurs erreurs : reprends la notion avec davantage de guidage.
`;
    }

    /*
     * MODE CORRECTION
     */
    if (isCorrection) {
      mission += `

MODE CORRECTION ACTIVÉ

Analyse précisément la réponse de l'élève.

Si elle est correcte :
- félicite l'élève ;
- explique pourquoi ;
- donne le résultat.

Si elle est partiellement correcte :
- indique ce qui est correct ;
- indique ce qui doit être amélioré ;
- guide l'élève.

Si elle est incorrecte :
- explique précisément l'erreur ;
- reprends le raisonnement ;
- donne la bonne réponse.

Pour les mathématiques, refais toujours le calcul indépendamment.
`;
    }

    /*
     * MODE TUTORAT NORMAL
     */
    if (!isQuiz && !isExercise && !isCorrection) {
      mission += `

MODE TUTORAT GÉNÉRAL

Réponds directement à la question de l'élève.

Si l'élève pose une question scolaire :
- explique simplement ;
- donne un exemple si utile ;
- adapte l'explication à son niveau.

Pour les mathématiques, montre les étapes du raisonnement
et vérifie le résultat.
`;
    }

    /*
     * ADAPTATION
     */
    mission += `

ADAPTATION DE LA DIFFICULTÉ

Observe l'historique récent.

Si l'élève réussit :
- augmente progressivement la difficulté.

Si l'élève réussit partiellement :
- consolide la notion.

Si l'élève se trompe :
- explique l'erreur ;
- évite d'augmenter immédiatement la difficulté.

Ne change jamais brutalement de niveau.

HISTORIQUE RÉCENT :

${historyText || "Aucun historique disponible."}

MESSAGE ACTUEL DE L'ÉLÈVE :

${message}

Réponds maintenant à l'élève.
`;

    /*
     * Appel Gemini
     */
    const response = await fetch(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent?key=" +
        encodeURIComponent(apiKey),
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          contents: [
            {
              role: "user",
              parts: [
                {
                  text: mission
                }
              ]
            }
          ],
          generationConfig: {
            temperature: isQuiz ? 0.3 : 0.5,
            maxOutputTokens: 4096
          }
        })
      }
    );

    if (!response.ok) {
      const errorText = await response.text();

      console.error("Erreur Gemini :", errorText);

      return res.status(500).json({
        error: "Une erreur est survenue avec le service pédagogique."
      });
    }

    const data = await response.json();

    const answer =
      data?.candidates?.[0]?.content?.parts
        ?.map((part) => part.text || "")
        .join("") || "";

    if (!answer.trim()) {
      return res.status(500).json({
        error: "Klasévia n'a pas reçu de réponse exploitable."
      });
    }

    return res.status(200).json({
      answer
    });
  } catch (error) {
    console.error("Erreur API tutor :", error);

    return res.status(500).json({
      error: "Une erreur interne est survenue."
    });
  }
}