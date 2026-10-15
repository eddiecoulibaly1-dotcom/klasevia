export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Méthode non autorisée." });
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

    const instructions = `
Tu es Klasévia, un assistant pédagogique spécialisé dans
l'accompagnement des élèves en Côte d'Ivoire.

Niveau scolaire : ${String(grade).slice(0, 100) || "non précisé"}
Série : ${String(serie).slice(0, 100) || "non précisée"}
Matière : ${String(subject).slice(0, 100) || "toutes matières"}
Mode : ${String(mode).slice(0, 100)}
Difficulté souhaitée : ${String(difficulty).slice(0, 100)}

RÈGLES :
- Réponds en français clair, sauf si l'élève demande une autre langue.
- Adapte tes explications au niveau scolaire indiqué.
- Tiens compte de l'ensemble des échanges précédents.
- Pour une question de suivi, réponds en tenant compte de la conversation.
- Explique les étapes du raisonnement pédagogique et donne des exemples utiles.
- Pour un exercice, détaille les étapes de résolution et vérifie le résultat.
- Si une information manque ou si tu n'es pas sûr, indique-le honnêtement.
- Si un document ou une image est fourni, examine son contenu avant de répondre.
- Ne prétends pas voir un document qui n'a pas été joint.
- Reste bienveillant, précis et encourageant.
`;

    // Vérification de l'image jointe.
    const currentParts = [{ text: instructions + "\n\nQuestion actuelle :\n" + text }];

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

    // Vérification du document PDF.
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
        text: "Document PDF joint : " +
          String(document.name || "document.pdf").slice(0, 200),
      });

      currentParts.push({
        inline_data: {
          mime_type: "application/pdf",
          data: document.data.replace(/^data:[^,]*;base64,/, ""),
        },
      });
    }

    // Conserve uniquement les derniers échanges textuels.
    // Les pièces jointes précédentes ne sont pas retransmises.
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

      if (!content.trim()) continue;

      if (historyCharacters + content.length > 20000) break;

      historyCharacters += content.length;

      previousContents.push({
        role:
          message.role === "assistant" || message.role === "model"
            ? "model"
            : "user",
        parts: [{ text: content }],
      });
    }

    const contents = [
      ...previousContents,
      {
        role: "user",
        parts: currentParts,
      },
    ];

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

    if (!response.ok) {
      console.error("Erreur Gemini :", data);

      return res.status(502).json({
        error:
          data?.error?.message ||
          "Le service d'intelligence artificielle n'a pas répondu correctement.",
      });
    }

    const answer = data?.candidates?.[0]?.content?.parts
      ?.map((part) => part.text || "")
      .join("")
      .trim();

    if (!answer) {
      return res.status(502).json({
        error: "L'IA n'a pas produit de réponse. Réessaie.",
      });
    }

    return res.status(200).json({ answer });
  } catch (error) {
    console.error("Erreur API Klasévia :", error);

    return res.status(500).json({
      error: "Une erreur est survenue. Réessaie dans quelques instants.",
    });
  }
}