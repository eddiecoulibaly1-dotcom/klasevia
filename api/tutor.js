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
    return res.status(503).json({
      error: "Le service IA n'est pas configuré. Vérifie la variable GEMINI_API_KEY dans Vercel."
    });
  }

  const niveau = grade || "non précisé";
  const serieEleve = serie || "Tronc commun";
  const matiere = subject || "non précisée";
  const detail = difficulty || "normal";

  const mission =
    mode === "explication"
      ? `Explique la notion demandée progressivement. Commence par une définition simple, puis explique les étapes, donne un exemple entièrement résolu, indique les erreurs fréquentes et propose 3 exercices progressifs avec leurs corrigés à la fin.`
      : `Résume fidèlement le cours fourni. Présente un titre, les objectifs, un résumé structuré, les définitions et formules essentielles, un exemple expliqué, 5 points à retenir et 5 exercices progressifs avec leurs corrigés à la fin. Signale clairement les informations qui ne figurent pas dans le cours.`;

  const prompt = `
Tu es Klasévia, un répétiteur numérique bienveillant
pour les élèves de Côte d'Ivoire.

Réponds en français clair et adapte tes explications
au programme et au niveau scolaire indiqués.

Classe : ${niveau}
Série : ${serieEleve}
Matière : ${matiere}
Niveau de détail : ${detail}

Pour les élèves de Première et de Terminale,
tiens compte de leur série :
- Série A : privilégie les matières littéraires
  lorsque cela est pertinent.
- Série C : tiens compte de l'orientation
  mathématiques et sciences physiques.
- Série D : tiens compte de l'orientation
  mathématiques et sciences de la vie et de la Terre.

Ne suppose pas que toutes les séries ont exactement
les mêmes programmes. Si tu n'es pas certain d'un point
du programme ivoirien, indique-le honnêtement.

Mission :
${mission}

Contenu ou question de l'élève :
${text}

Ne prétends pas remplacer l'enseignant.
Si les informations fournies sont insuffisantes,
signale-le clairement.
`;

  try {
    const response = await fetch(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent",
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
        data?.error?.message
      );

      return res.status(502).json({
        error: "Le service IA a refusé la demande. Vérifie la clé API, les autorisations, le modèle et les quotas dans Google AI Studio."
      });
    }

    const answer = data?.candidates?.[0]?.content?.parts
      ?.map((part) => part.text || "")
      .join("\n")
      .trim();

    if (!answer) {
      return res.status(502).json({
        error: "L'IA n'a pas renvoyé de réponse exploitable. Réessaie."
      });
    }

    return res.status(200).json({ answer });
  } catch (error) {
    console.error("Klasévia request failed:", error);

    return res.status(500).json({
      error: "Erreur serveur pendant la demande à l'IA. Réessaie plus tard."
    });
  }
}