// Klasévia : service IA sécurisé côté serveur
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
    text
  } = req.body || {};

  if (
    typeof text !== "string" ||
    !text.trim() ||
    text.length > 30000
  ) {
    return res.status(400).json({
      error: "Ajoute un texte ou une question (maximum 30 000 caractères)."
    });
  }

  const key = process.env.GEMINI_API_KEY;

  if (!key) {
    console.error("GEMINI_API_KEY absente dans Vercel.");

    return res.status(503).json({
      error: "Le service IA n'est pas configuré. Vérifie GEMINI_API_KEY dans Vercel."
    });
  }

  const niveau = grade || "non précisé";
  const serieEleve = serie || "Tronc commun";
  const matiere = subject || "non précisée";
  const detail = difficulty || "normal";

  const mission =
    mode === "explication"
      ? `Explique la notion progressivement.
Commence par une définition simple, explique les étapes,
donne un exemple entièrement résolu, indique les erreurs
fréquentes et propose 3 exercices progressifs avec leurs
corrigés à la fin.`
      : `Résume fidèlement le cours fourni.
Présente un titre, les objectifs, un résumé structuré,
les définitions et formules essentielles, un exemple expliqué,
5 points à retenir et 5 exercices progressifs avec leurs
corrigés à la fin. Signale les informations absentes du cours.`;

  const prompt = `
Tu es Klasévia, un répétiteur numérique bienveillant
pour les élèves de Côte d'Ivoire.

Réponds en français clair, avec une pédagogie progressive.

Classe : ${niveau}
Série : ${serieEleve}
Matière : ${matiere}
Niveau de détail : ${detail}

Adapte les explications à la série :
- Série A : orientation littéraire, selon le sujet.
- Série C : mathématiques et sciences physiques.
- Série D : mathématiques et sciences de la vie et de la Terre.

Ne suppose pas que les programmes sont identiques.
Si tu n'es pas certain d'un point du programme ivoirien,
indique-le honnêtement.

Mission :
${mission}

Contenu ou question de l'élève :
${text}

Ne prétends pas remplacer l'enseignant.
Si les informations sont insuffisantes, signale-le.
`;

  try {
    const response = await fetch(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": key
        },
        body: JSON.stringify({
          contents: [
            {
              parts: [{ text: prompt }]
            }
          ],
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
        error:
          "Le service IA est momentanément indisponible. Réessaie plus tard."
      });
    }

    const answer = data?.candidates?.[0]?.content?.parts
      ?.map((part) => part.text || "")
      .join("\n")
      .trim();

    if (!answer) {
      console.error(
        "Gemini n'a renvoyé aucune réponse exploitable.",
        JSON.stringify(data?.promptFeedback || {})
      );

      return res.status(502).json({
        error: "L'IA n'a pas renvoyé de réponse exploitable. Réessaie."
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



