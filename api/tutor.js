
export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Méthode non autorisée." });
  }

  const { mode, grade, serie, subject, difficulty, text, image } =
    req.body || {};

  if (
    (!text || typeof text !== "string" || !text.trim()) &&
    !image
  ) {
    return res.status(400).json({
      error: "Écris une question ou ajoute une image."
    });
  }

  if (typeof text === "string" && text.length > 30000) {
    return res.status(400).json({
      error: "Le texte est trop long (maximum 30 000 caractères)."
    });
  }

  const key = process.env.GEMINI_API_KEY;

  if (!key) {
    return res.status(503).json({
      error: "Le service IA n'est pas configuré."
    });
  }

  if (
    image &&
    (
      typeof image.data !== "string" ||
      !["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"].includes(image.mimeType) ||
      image.data.length > 8_000_000
    )
  ) {
    return res.status(400).json({
      error: "Image non prise en charge ou trop volumineuse. Envoie une photo JPG, PNG ou WebP de moins de 6 Mo."
    });
  }

  const prompt = `
Tu es Klasévia, un répétiteur numérique bienveillant
pour les élèves de Côte d'Ivoire.

Réponds en français clair et adapte ton explication au niveau de l'élève.

Classe : ${grade || "non précisée"}
Série : ${serie || "Tronc commun"}
Matière : ${subject || "non précisée"}
Niveau de détail : ${difficulty || "normal"}

${mode === "explication"
  ? "Explique progressivement la notion, donne un exemple résolu et propose trois exercices corrigés."
  : "Si un cours est fourni, crée une fiche structurée avec les idées essentielles, les définitions et des exercices corrigés."}

Si une image est jointe :
- Lis attentivement le texte, les nombres, les symboles et les consignes visibles.
- Pour une photo d'exercice, retranscris l'énoncé utile puis résous-le étape par étape.
- Décris les éléments visuels pertinents lorsqu'ils aident à répondre.
- Si l'image est floue, coupée ou illisible, indique-le et demande une photo plus nette.
- Ne prétends pas voir ce qui n'est pas visible.
- Respecte les notations mathématiques et utilise LaTeX pour les formules.

Question ou consigne de l'élève :
${text || "Analyse l'image jointe et explique ce qu'elle contient."}

Ne prétends pas remplacer l'enseignant.
Si tu n'es pas certain d'une information, indique-le honnêtement.
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
    console.error("Klasévia request failed:", error?.message || error);

    return res.status(500).json({
      error: "Erreur serveur pendant la demande à l'IA."
    });
  }
}
