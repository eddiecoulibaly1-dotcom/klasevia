// Vercel serverless function: the API key stays on the server, not in the browser.
export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Méthode non autorisée." });
  const { mode, grade, subject, difficulty, text } = req.body || {};
  if (!text || typeof text !== "string" || text.length > 30000) {
    return res.status(400).json({ error: "Ajoute un texte (maximum 30 000 caractères)." });
  }
  const key = process.env.GEMINI_API_KEY;
  if (!key) return res.status(503).json({ error: "Le service IA n'est pas encore configuré. Ajoute GEMINI_API_KEY dans les variables d'environnement du serveur." });

  const task = mode === "explication"
    ? `Explique la notion demandée avec une pédagogie claire, progressive et bienveillante. Commence par une définition simple, explique étape par étape, donne une analogie du quotidien en Côte d'Ivoire si elle est pertinente, un exemple entièrement résolu, les erreurs fréquentes, puis 3 exercices progressifs avec corrigé séparé à la fin.`
    : `Synthétise fidèlement le cours fourni. Produis : un titre, les objectifs d'apprentissage, un résumé structuré, les définitions et formules essentielles, un exemple expliqué, 5 points à mémoriser, puis 5 exercices progressifs avec corrigé séparé à la fin. N'invente pas de faits absents du cours sans les signaler.`;
  const prompt = `Tu es Klasévia, un répétiteur numérique bienveillant pour les élèves de Côte d'Ivoire, du primaire à la Terminale. Réponds en français clair, adapté au niveau indiqué. Ne prétends pas que ton contenu remplace l'enseignant. Si le texte est insuffisant ou ambigu, dis-le clairement.\nNiveau scolaire : ${grade || "non précisé"}.\nMatière : ${subject || "non précisée"}.\nStyle : ${difficulty || "normal"}.\nMission : ${task}\n\nContenu fourni par l'élève :\n${text}`;

  try {
    const upstream = await fetch("https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=" + encodeURIComponent(key), {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { temperature: 0.4, maxOutputTokens: 4096 } })
    });
    const data = await upstream.json();
    if (!upstream.ok) {
      console.error("Gemini error", upstream.status, data?.error?.message);
      return res.status(502).json({ error: "Le service IA a refusé la demande. Vérifie la clé API, les quotas et la configuration du modèle." });
    }
    const answer = data?.candidates?.[0]?.content?.parts?.map(p => p.text || "").join("\n").trim();
    if (!answer) return res.status(502).json({ error: "L'IA n'a pas renvoyé de réponse exploitable. Réessaie." });
    return res.status(200).json({ answer });
  } catch (e) {
    console.error("Tutor request failed", e);
    return res.status(500).json({ error: "Erreur serveur pendant la demande à l'IA." });
  }
}
