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
      theme = "",
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

    const normalizedMessage = String(message)
      .toLowerCase()
      .trim();

    const normalizedTheme = String(theme || "").trim();

    const recentHistory = Array.isArray(history)
      ? history.slice(-20)
      : [];

    const historyText = recentHistory
      .map((item) => {
        const role =
          item.role === "user"
            ? "Élève"
            : "Klasévia";

        return `${role}: ${item.content || ""}`;
      })
      .join("\n");

    /*
     * ============================================================
     * DÉTECTION DES INTENTIONS
     * ============================================================
     */

    const isQuizRequest =
      mode === "quiz" ||
      normalizedMessage.includes("quiz") ||
      normalizedMessage.includes("qcm") ||
      normalizedMessage.includes("question à choix") ||
      normalizedMessage.includes("teste-moi") ||
      normalizedMessage.includes("teste moi") ||
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
     * ============================================================
     * DERNIER MESSAGE DE KLASÉVIA
     * ============================================================
     */

    const assistantMessages = recentHistory.filter(
      (item) => item.role === "assistant"
    );

    const lastAssistantMessage =
      assistantMessages.length > 0
        ? String(
            assistantMessages[assistantMessages.length - 1]?.content || ""
          )
        : "";

    const lastAssistantLower =
      lastAssistantMessage.toLowerCase();

    /*
     * ============================================================
     * DÉTECTION ROBUSTE D'UNE QUESTION DE QUIZ
     * ============================================================
     */

    const hasQuizChoices =
      /\bA[\.\)]/i.test(lastAssistantMessage) &&
      /\bB[\.\)]/i.test(lastAssistantMessage) &&
      /\bC[\.\)]/i.test(lastAssistantMessage) &&
      /\bD[\.\)]/i.test(lastAssistantMessage);

    const hasQuizQuestionWords =
      lastAssistantLower.includes("question") ||
      lastAssistantLower.includes("quelle") ||
      lastAssistantLower.includes("quel") ||
      lastAssistantLower.includes("quelle est") ||
      lastAssistantLower.includes("quel est") ||
      lastAssistantLower.includes("combien") ||
      lastAssistantLower.includes("que vaut") ||
      lastAssistantLower.includes("calcule") ||
      lastAssistantLower.includes("détermine") ||
      lastAssistantLower.includes("choisis") ||
      lastAssistantLower.includes("réponds") ||
      lastAssistantLower.includes("réponse");

    const hasQuizNumbering =
      /question\s*\d+/i.test(lastAssistantMessage) ||
      /question\s*n[°o]?\s*\d+/i.test(lastAssistantMessage);

    const hasPreviousQuizQuestion =
      hasQuizChoices ||
      hasQuizQuestionWords ||
      hasQuizNumbering;

    /*
     * ============================================================
     * DÉTECTION DES RÉPONSES COURTES
     * ============================================================
     */

    const isLetterAnswer =
      /^(?:a|b|c|d)[\.\)]?$/i.test(
        normalizedMessage
      );

    const isFractionAnswer =
      /^-?\d+\s*\/\s*-?\d+$/.test(
        normalizedMessage
      );

    const isNumberAnswer =
      /^-?\d+(?:[.,]\d+)?$/.test(
        normalizedMessage
      );

    const isShortTextAnswer =
      /^[a-zàâçéèêëîïôûùüÿñæœ\s'-]{1,40}$/i.test(
        normalizedMessage
      ) &&
      normalizedMessage.split(/\s+/).length <= 6;

    const looksLikeShortAnswer =
      normalizedMessage.length <= 80 &&
      (
        isLetterAnswer ||
        isFractionAnswer ||
        isNumberAnswer ||
        isShortTextAnswer
      );

    /*
     * ============================================================
     * RÉPONSE À UN QUIZ
     * ============================================================
     */

    const isQuizAnswer =
      !isQuizRequest &&
      hasPreviousQuizQuestion &&
      looksLikeShortAnswer;

    const isQuiz =
      isQuizRequest ||
      isQuizAnswer ||
      mode === "quiz";

    /*
     * ============================================================
     * MISSION DE BASE
     * ============================================================
     */

    let mission = `
Tu es Klasévia, un tuteur scolaire intelligent conçu pour accompagner
les élèves en Côte d'Ivoire.

Niveau scolaire : ${grade || "non précisé"}
Matière : ${subject || "non précisée"}
Série : ${serie || "non précisée"}
Thème : ${normalizedTheme || "non précisé"}
Difficulté : ${difficulty || "non précisée"}

Tu réponds toujours en français clair, naturel et adapté au niveau
scolaire de l'élève.

IMPORTANT POUR LE THÈME :

Lorsque le champ "Thème" est renseigné, il représente la notion,
le chapitre ou le sujet précis que l'élève souhaite travailler.

Tu dois utiliser ce thème comme contexte pédagogique prioritaire.

Par exemple :

- Niveau : 5e
- Matière : Mathématiques
- Thème : Fractions

Dans ce cas, les explications, exercices, exemples et questions
doivent porter principalement sur les fractions.

Autre exemple :

- Niveau : 3e
- Matière : Français
- Thème : Les figures de style

Dans ce cas, le contenu doit principalement concerner les figures
de style.

Si aucun thème n'est renseigné, réponds normalement en utilisant
la matière, le niveau, la série et le message de l'élève.

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
     * ============================================================
     * MODE QUIZ
     * ============================================================
     */

    if (isQuiz) {
      if (isQuizAnswer) {
        mission += `

MODE : CORRECTION D'UNE RÉPONSE DE QUIZ

Le message actuel de l'élève est UNE RÉPONSE à la dernière question
de quiz posée par Klasévia.

IMPORTANT :

- NE recommence PAS le quiz.
- NE demande PAS quelle est la matière.
- NE demande PAS quel est le chapitre.
- NE dis PAS que l'élève n'a pas répondu.
- NE demande PAS à l'élève de répéter sa réponse.
- Traite directement le message actuel comme une tentative de réponse.

La réponse actuelle de l'élève est exactement :

"${message}"

Même si la réponse est très courte, elle est valide comme tentative.

Exemples de réponses valides :

A
B
C
D
A.
B)
2/4
6/10
3/5
12
7,5
7.5

Tu dois :

1. retrouver la dernière question de quiz dans l'historique ;
2. retrouver les choix A, B, C et D s'ils existent ;
3. déterminer la bonne réponse ;
4. lire exactement la réponse actuelle de l'élève ;
5. comparer la réponse de l'élève à la bonne réponse ;
6. dire clairement si elle est correcte ou incorrecte ;
7. expliquer brièvement pourquoi ;
8. donner la bonne réponse si nécessaire ;
9. proposer ensuite une nouvelle question.

Si l'élève répond "C", cela signifie qu'il choisit la proposition C.

Si l'élève répond "2/4", cela signifie qu'il donne exactement
la fraction 2/4.

Si l'élève répond "6/10", cela signifie qu'il donne exactement
la fraction 6/10.

Tu ne dois jamais transformer une réponse de l'élève en une autre
réponse avant de la corriger.
`;
      } else {
        mission += `

MODE : CRÉATION OU POURSUITE D'UN QUIZ

Tu dois créer ou poursuivre un quiz scolaire.

Si l'élève vient de demander un quiz, commence DIRECTEMENT par
la première question.

Le thème fourni par Klasévia doit être utilisé comme sujet principal
du quiz lorsqu'il est renseigné.

Ne demande pas quel chapitre l'élève souhaite travailler si le
champ "Thème" contient déjà cette information.

Exemple :

Niveau : 5e
Matière : Mathématiques
Thème : Fractions

Dans ce cas, le quiz doit porter sur les fractions de niveau 5e.

RÈGLES :

1. Pose une seule question à la fois.
2. Pour un QCM, propose exactement quatre choix :
   A, B, C et D.
3. Une seule réponse doit être correcte.
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

Pour toute question de mathématiques, vérifie toi-même le calcul
avant de corriger l'élève.

Pour les fractions :

- le nombre du haut est le NUMÉRATEUR ;
- le nombre du bas est le DÉNOMINATEUR ;
- ne jamais inverser ces deux termes ;
- vérifie l'équivalence des fractions ;
- vérifie les simplifications ;
- vérifie les opérations ;
- vérifie les propositions A, B, C et D.

EXEMPLE :

18/12

Numérateur = 18
Dénominateur = 12

PGCD(18,12) = 6

18 ÷ 6 = 3
12 ÷ 6 = 2

Donc :

18/12 = 3/2

Autre exemple :

6/10

PGCD(6,10) = 2

6 ÷ 2 = 3
10 ÷ 2 = 5

Donc :

6/10 = 3/5

Il est INTERDIT d'écrire :

6/10 = 5/3

Il est également interdit d'inverser numérateur et dénominateur.

Pour chaque calcul, le résultat mathématique vérifié doit avoir
priorité sur toute réponse préparée précédemment.
`;
    }

    /*
     * ============================================================
     * MODE EXERCICE
     * ============================================================
     */

    if (isExercise) {
      mission += `

MODE EXERCICE ACTIVÉ

Propose un exercice adapté au niveau de l'élève.

Le thème doit être respecté lorsqu'il est renseigné.

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
     * ============================================================
     * MODE CORRECTION
     * ============================================================
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

Lorsque le thème est renseigné, vérifie également que la correction
reste centrée sur ce thème.
`;
    }

    /*
     * ============================================================
     * MODE TUTORAT NORMAL
     * ============================================================
     */

    if (!isQuiz && !isExercise && !isCorrection) {
      mission += `

MODE TUTORAT GÉNÉRAL

Réponds directement à la question de l'élève.

Si l'élève pose une question scolaire :
- explique simplement ;
- donne un exemple si utile ;
- adapte l'explication à son niveau.

Lorsque le thème est renseigné, utilise-le pour orienter
l'explication et les exemples.

Pour les mathématiques, montre les étapes du raisonnement
et vérifie le résultat.
`;
    }

    /*
     * ============================================================
     * ADAPTATION
     * ============================================================
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
     * ============================================================
     * APPEL GEMINI
     * ============================================================
     */

    const response = await fetch(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent?key=" +
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