
export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({
      error: "Méthode non autorisée."
    });
  }

  const {
    mode,
    grade,
    serie,
    subject,
    difficulty,
    text,
    image,
    document
  } = req.body || {};

  const hasText = typeof text === "string" && text.trim();
  const hasImage = Boolean(image);
  const hasDocument = Boolean(document);

  if (!hasText && !hasImage && !hasDocument) {
    return res.status(400).json({
      error: "Écris une question ou ajoute un fichier."
    });
  }

  if (typeof text === "string" && text.length > 30000) {
    return res.status(400).json({
      error: "Le texte dépasse la limite de 30 000 caractères."
    });
  }

  const key = process.env.GEMINI_API_KEY;

  if (!key) {
    return res.status(503).json({
      error: "Le service IA n'est pas configuré."
    });
  }

  const allowedImages = [
    "image/jpeg",
    "image/png",
    "image/webp"
  ];

  if (image) {
    if (
      typeof image.data !== "string" ||
      !allowedImages.includes(image.mimeType) ||
      image.data.length > 6000000
    ) {
      return res.status(400).json({
        error: "Image non prise en charge ou trop volumineuse."
      });
    }
  }

  if (document) {
    if (
      typeof document.data !== "string" ||
      document.mimeType !== "application/pdf" ||
      typeof document.name !== "string" ||
      document.data.length > 4500000
    ) {
      return res.status(400).json({
        error: "PDF invalide ou trop volumineux. Essaie un PDF de moins de 3 Mo."
      });
    }
  }

  const prompt = `
Tu es Klasévia, un assistant éducatif polyvalent,
bienveillant et rigoureux.

Tu accompagnes les élèves du primaire à la Terminale,
dans toutes les matières et toutes les séries.

CONTEXTE
Classe : ${grade || "non précisée"}
Série : ${serie || "non précisée"}
Matière : ${subject || "non précisée"}
Niveau de détail : ${difficulty || "normal"}

MÉTHODE
- Réponds d'abord à la demande réelle de l'élève.
- Explique les étapes importantes clairement.
- Adapte le vocabulaire à son niveau.
- Justifie les calculs et les conclusions.
- En mathématiques, vérifie les calculs et les conditions
  d'application des propriétés utilisées.
- En physique-chimie, indique les formules et les unités.
- En français, philosophie, histoire, langues et autres
  matières, utilise la méthode adaptée au sujet.
- Ne fabrique pas de faits, de citations ou de résultats.
- Si un document est illisible ou incomplet, signale-le.

MODE
${
  mode === "synthese"
    ? "Prépare une fiche de révision organisée, avec les notions essentielles, définitions et exemples utiles."
    : "Explique le sujet progressivement. Pour un exercice, présente la démarche et la solution justifiée."
}

DOCUMENT JOINT
Si un PDF ou une image est fourni :
- Examine réellement son contenu.
- Repère les consignes, textes, tableaux, schémas et exercices.
- Réponds à la question de l'élève à partir du document.
- Si aucune question n'est écrite, propose une explication
  ou un résumé utile du document.

QUESTION DE L'ÉLÈVE
${hasText ? text.trim() : "Analyse le document joint et explique son contenu."}

Réponds en français clair, avec des titres et des étapes
lorsque cela facilite la compréhension.
`;

  try {
    const parts = [{ text: prompt }];

    if (image) {
      parts.push({
        inline_data: {
          mime_type: image.mimeType,
          data: image.data
        }
      });
    }

    if (document) {
      parts.push({
        inline_data: {
          mime_type: "application/pdf",
          data: document.data
        }
      });
    }

    const response = await fetch(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": key
        },
        body: JSON.stringify({
          contents: [{ parts }],
          generationConfig: {
            temperature: 0.4,
            maxOutputTokens: 4096
          }
        })
      }
    );

    const data = await response.json();

    if (!response.ok) {
      console.error(
        "Gemini error:",
        response.status,
        data?.error?.message || "Erreur inconnue"
      );

      return res.status(502).json({
        error: "Le service IA est indisponible. Réessaie plus tard."
      });
    }

    const answer = data?.candidates?.[0]?.content?.parts
      ?.map((part) => part.text || "")
      .join("\n")
      .trim();

    if (!answer) {
      return res.status(502).json({
        error: "Aucune réponse exploitable reçue. Réessaie."
      });
    }

    return res.status(200).json({ answer });
  } catch (error) {
    console.error(
      "Klasévia request failed:",
      error?.message || error
    );

    return res.status(500).json({
      error: "Erreur serveur pendant la demande à l'IA."
    });
  }
}
