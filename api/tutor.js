export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({
      error: "Méthode non autorisée.",
    });
  }

  try {
    const {
      mode = "explication",
      grade = "",
      serie = "",
      subject = "",
      difficulty = "normal",
      text = "",
      image = null,
      document = null,
      history = [],
    } = req.body || {};

    const apiKey = process.env.GEMINI_API_KEY;

    if (!apiKey) {
      return res.status(500).json({
        error: "La clé de l'IA n'est pas configurée sur le serveur.",
      });
    }

    if (typeof text !== "string" || !text.trim()) {
      return res.status(400).json({
        error: "Écris une question avant d'envoyer.",
      });
    }

    if (text.length > 30000) {
      return res.status(400).json({
        error: "La question est trop longue. Réduis sa longueur.",
      });
    }

    /*
     * ---------------------------------------------------------
     * PROFIL PÉDAGOGIQUE DE L'ÉLÈVE
     * ---------------------------------------------------------
     */

    const cleanGrade = String(grade).slice(0, 100).trim();
    const cleanSerie = String(serie).slice(0, 100).trim();
    const cleanSubject = String(subject).slice(0, 100).trim();
    const cleanMode = String(mode).slice(0, 100).trim();
    const cleanDifficulty = String(difficulty).slice(0, 100).trim();

    const instructions = `
Tu es Klasévia, un tuteur scolaire intelligent spécialisé dans
l'accompagnement des élèves en Côte d'Ivoire.

TON OBJECTIF PRINCIPAL :
Tu ne dois pas seulement répondre aux questions.
Tu dois aider l'élève à COMPRENDRE, APPRENDRE, S'ENTRAÎNER et PROGRESSER.

PROFIL DE L'ÉLÈVE :
- Niveau scolaire : ${cleanGrade || "non précisé"}
- Série : ${cleanSerie || "non précisée"}
- Matière : ${cleanSubject || "toutes matières"}
- Mode demandé : ${cleanMode || "explication"}
- Difficulté souhaitée : ${cleanDifficulty || "normal"}

RÈGLES PÉDAGOGIQUES :

1. ADAPTATION AU NIVEAU
- Adapte toujours ton vocabulaire, tes exemples et la profondeur de ton explication au niveau scolaire indiqué.
- Un élève de primaire doit recevoir une explication beaucoup plus simple qu'un élève de Terminale.
- Ne donne pas une explication universitaire à un élève scolaire.
- Si le niveau n'est pas précisé, utilise un niveau scolaire général et demande une précision seulement si elle est réellement nécessaire.

2. COMPRÉHENSION AVANT LA SOLUTION
- Cherche d'abord à faire comprendre.
- Pour un exercice, ne donne pas automatiquement la réponse finale sans explication.
- Décompose les problèmes difficiles en petites étapes.
- Montre les méthodes utilisées.
- Vérifie les calculs et les conclusions avant de répondre.

3. APPRENTISSAGE ACTIF
- Lorsque c'est pertinent, termine une explication par une petite question ou un exercice permettant à l'élève de vérifier sa compréhension.
- Ne transforme toutefois pas chaque réponse en interrogation.
- Si l'élève demande simplement une information précise, réponds directement.

4. CORRECTION DES ERREURS
- Si l'élève donne une mauvaise réponse, explique calmement où se trouve l'erreur.
- Ne te contente jamais de dire "c'est faux".
- Montre comment parvenir à la bonne réponse.
- Si l'erreur révèle une difficulté fondamentale, reviens brièvement à la notion nécessaire.

5. PERSONNALISATION
- Tiens compte des échanges précédents.
- Si l'élève montre plusieurs fois la même difficulté, adapte l'explication et propose un entraînement ciblé.
- Ne répète pas inutilement exactement la même explication.
- Utilise les informations disponibles dans la conversation pour poursuivre naturellement l'apprentissage.

6. STYLE
- Réponds en français clair, naturel et accessible.
- Sois bienveillant, patient, précis et encourageant.
- Évite les phrases inutilement longues.
- Utilise des titres, listes, étapes et exemples lorsque cela améliore la compréhension.
- Utilise Markdown lorsque cela facilite la lecture.
- Pour les mathématiques et sciences, utilise une notation claire.

7. EXERCICES
Lorsqu'il s'agit d'un exercice :
- identifie ce qui est demandé ;
- rappelle brièvement la notion nécessaire ;
- présente la méthode ;
- résous étape par étape ;
- vérifie le résultat ;
- lorsque c'est utile, propose ensuite un exercice similaire à faire seul.

8. RÉVISION
Lorsqu'un élève demande une révision :
- commence par un résumé des notions essentielles ;
- identifie les points importants à mémoriser ;
- donne des exemples ;
- termine éventuellement par quelques questions de vérification.

9. PRÉPARATION AUX EXAMENS
Si l'élève prépare un examen :
- adopte un niveau de difficulté correspondant à son niveau scolaire ;
- privilégie les exercices et notions réellement utiles ;
- explique les erreurs ;
- propose une progression lorsque c'est pertinent.

10. HONNÊTETÉ
- Si une information est incertaine, indique-le clairement.
- N'invente jamais une information, une source, une formule ou un résultat.
- Si un document n'est pas réellement accessible, ne prétends pas l'avoir lu.

11. DOCUMENTS ET IMAGES
- Si une image est fournie, analyse réellement son contenu avant de répondre.
- Si un PDF est fourni, utilise son contenu pour répondre.
- Ne prétends jamais avoir analysé un document qui n'a pas été joint.

12. CONTEXTE IVOIRIEN
- Lorsque cela est pertinent, utilise des exemples compréhensibles pour un élève vivant en Côte d'Ivoire.
- Respecte les niveaux scolaires indiqués par Klasévia.
- Pour les classes sans série, ne crée pas artificiellement une série.
- Pour les classes du lycée, tiens compte de la série lorsqu'elle est fournie.

IMPORTANT :
Tu es un TUTEUR, pas seulement un moteur de recherche.
Ta priorité est que l'élève comprenne et puisse refaire seul.
`;

    /*
     * ---------------------------------------------------------
     * QUESTION ACTUELLE
     * ---------------------------------------------------------
     */

    const currentParts = [
      {
        text:
          instructions +
          "\n\nQuestion actuelle de l'élève :\n" +
          text.trim(),
      },
    ];

    /*
     * ---------------------------------------------------------
     * IMAGE
     * ---------------------------------------------------------
     */

    if (image) {
      const allowedImageTypes = [
        "image/jpeg",
        "image/png",
        "image/webp",
      ];

      if (
        !allowedImageTypes.includes(image.mimeType) ||
        typeof image.data !== "string" ||
        image.data.length > 6000000
      ) {
        return res.status(400).json({
          error: "Image non valide ou trop volumineuse.",
        });
      }

      currentParts.push({
        inline_data: {
          mime_type: image.mimeType,
          data: image.data.replace(/^data:[^,]*;base64,/, ""),
        },
      });
    }

    /*
     * ---------------------------------------------------------
     * PDF
     * ---------------------------------------------------------
     */

    if (document) {
      if (
        document.mimeType !== "application/pdf" ||
        typeof document.data !== "string" ||
        document.data.length > 4500000
      ) {
        return res.status(400).json({
          error: "PDF non valide ou trop volumineux.",
        });
      }

      currentParts.push({
        text:
          "Document PDF joint : " +
          String(document.name || "document.pdf").slice(0, 200),
      });

      currentParts.push({
        inline_data: {
          mime_type: "application/pdf",
          data: document.data.replace(/^data:[^,]*;base64,/, ""),
        },
      });
    }

    /*
     * ---------------------------------------------------------
     * HISTORIQUE DE CONVERSATION
     * ---------------------------------------------------------
     */

    const safeHistory = Array.isArray(history)
      ? history.slice(-12)
      : [];

    const previousContents = [];
    let historyCharacters = 0;

    for (const message of safeHistory) {
      if (
        !message ||
        !["user", "assistant", "model"].includes(message.role) ||
        typeof message.content !== "string"
      ) {
        continue;
      }

      const content = message.content.slice(0, 4000);

      if (!content.trim()) {
        continue;
      }

      if (historyCharacters + content.length > 20000) {
        break;
      }

      historyCharacters += content.length;

      previousContents.push({
        role:
          message.role === "assistant" || message.role === "model"
            ? "model"
            : "user",
        parts: [
          {
            text: content,
          },
        ],
      });
    }

    const contents = [
      ...previousContents,
      {
        role: "user",
        parts: currentParts,
      },
    ];

    /*
     * ---------------------------------------------------------
     * APPEL GEMINI
     * ---------------------------------------------------------
     */

    const response = await fetch(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent?key=" +
        encodeURIComponent(apiKey),
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          contents,
          generationConfig: {
            temperature: 0.6,
            maxOutputTokens: 4096,
          },
        }),
      }
    );

    const data = await response.json();

    /*
     * ---------------------------------------------------------
     * ERREUR GEMINI
     * ---------------------------------------------------------
     */

    if (!response.ok) {
      console.error("Erreur Gemini :", data);

      return res.status(502).json({
        error:
          data?.error?.message ||
          "Le service d'intelligence artificielle n'a pas répondu correctement.",
      });
    }

    /*
     * ---------------------------------------------------------
     * EXTRACTION DE LA RÉPONSE
     * ---------------------------------------------------------
     */

    const answer = data?.candidates?.[0]?.content?.parts
      ?.map((part) => part.text || "")
      .join("")
      .trim();

    if (!answer) {
      return res.status(502).json({
        error: "L'IA n'a pas produit de réponse. Réessaie.",
      });
    }

    /*
     * ---------------------------------------------------------
     * RÉPONSE
     * ---------------------------------------------------------
     */

    return res.status(200).json({
      answer,
    });
  } catch (error) {
    console.error("Erreur API Klasévia :", error);

    return res.status(500).json({
      error:
        "Une erreur est survenue. Réessaie dans quelques instants.",
    });
  }
}