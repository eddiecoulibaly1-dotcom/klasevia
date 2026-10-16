
const MODEL = "gemini-3.6-flash";

const MAX_ATTEMPTS = 3;

const RETRYABLE_STATUS_CODES = new Set([
  429, 500, 502, 503, 504
]);

function normalizeText(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[’‘]/g, "'");
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function detectIntent(message, mode) {
  const text = normalizeText(message);

  const quizPatterns = [
    /\bquiz\b/,
    /\bqcm\b/,
    /\bquestionnaire\b/,
    /\bfais[- ]moi un test\b/,
    /\bdonne[- ]moi un test\b/,
    /\bteste[- ]moi\b/,
    /\bteste moi\b/,
    /\bnouveau quiz\b/,
    /\brecommence le quiz\b/
  ];

  const correctionPatterns = [
    /\bcorrige\b/,
    /\bcorriger\b/,
    /\bcorrection\b/,
    /\bverifie ma reponse\b/,
    /\bverifie mes reponses\b/
  ];

  const exercisePatterns = [
    /\bexercice(s)?\b/,
    /\bentrainement\b/,
    /\bentraine[- ]moi\b/,
    /\bpratique\b/,
    /\bdonne[- ]moi un probleme\b/,
    /\bpropose[- ]moi un probleme\b/
  ];

  if (mode === "quiz" || quizPatterns.some(p => p.test(text))) {
    return "quiz";
  }

  if (mode === "correction" || correctionPatterns.some(p => p.test(text))) {
    return "correction";
  }

  if (mode === "exercice" || exercisePatterns.some(p => p.test(text))) {
    return "exercice";
  }

  if (mode === "synthese" || mode === "synthèse") {
    return "synthese";
  }

  return "tutorat";
}

function getIntentInstructions(intent) {
  if (intent === "exercice") {
    return `
MODE PRIORITAIRE : EXERCICE.

L'élève demande un exercice. Tu dois en donner UN immédiatement.

- Commence directement par "### Exercice".
- N'écris aucune salutation ni introduction générale.
- Ne propose aucun menu ni liste de choix.
- Ne demande pas ce que l'élève souhaite faire.
- Respecte la classe, la matière et le thème.
- Donne un énoncé clair, avec une consigne précise.
- Ne donne ni la réponse ni la correction avant la tentative de l'élève.
- Termine par "À toi de jouer !".
- Vérifie la justesse mathématique de l'énoncé avant de répondre.
`;
  }

  if (intent === "synthese") {
    return `
MODE PRIORITAIRE : SYNTHÈSE DE COURS.

Produis une fiche de révision structurée, claire et fidèle au contenu
fourni. Présente les notions essentielles, les définitions,
les règles et des exemples adaptés au niveau. Ne demande pas à l'élève
ce qu'il souhaite faire si le cours ou le thème est déjà fourni.
`;
  }

  if (intent === "correction") {
    return `
MODE PRIORITAIRE : CORRECTION.

Corrige directement le travail ou la réponse de l'élève.
Explique ce qui est correct, identifie les erreurs et montre
le raisonnement juste, étape par étape. Ne commence pas par un accueil.
`;
  }

  if (intent === "quiz") {
    return `
L'élève semble demander un quiz. Si la demande concerne le quiz
structuré de l'application, rappelle brièvement qu'il peut demander
un quiz dédié. Ne prétends pas gérer un score ou un état de quiz
qui ne t'a pas été transmis.
`;
  }

  return `
MODE TUTORAT.

Réponds directement à la question de l'élève. Explique les notions
progressivement, avec des exemples utiles et un vocabulaire adapté.
`;
}

function buildPrompt({
  message,
  grade,
  subject,
  serie,
  theme,
  difficulty,
  mode,
  history
}) {
  const intent = detectIntent(message, mode);

  const recentHistory = Array.isArray(history)
    ? history.slice(-12)
    : [];

  const historyText = recentHistory
    .map(item => {
      const role = item.role === "assistant"
        ? "Klasévia"
        : "Élève";

      return `${role}: ${String(item.content || "").slice(0, 5000)}`;
    })
    .join("\n\n");

  const prompt = `
Tu es Klasévia, un tuteur scolaire pour les élèves de Côte d'Ivoire.

PARAMÈTRES PÉDAGOGIQUES
Classe : ${grade || "non précisée"}
Matière : ${subject || "non précisée"}
Série : ${serie || "non précisée"}
Thème choisi : ${theme || "non précisé"}
Niveau de détail : ${difficulty || "détaillé"}

RÈGLES GÉNÉRALES
- Réponds en français clair et naturel.
- Adapte tes explications au niveau scolaire indiqué.
- Si un thème est fourni, reste centré sur ce thème.
- Ne demande pas à nouveau une information déjà fournie.
- Pour les mathématiques, vérifie les calculs et les résultats.
- Ne prétends pas avoir lu un document si son contenu est inaccessible.
- Utilise des exemples ivoiriens lorsque cela est pertinent, sans forcer.

${getIntentInstructions(intent)}

HISTORIQUE RÉCENT
${historyText || "Aucun historique fourni."}

MESSAGE DE L'ÉLÈVE
${message || "L'élève a joint un document à analyser."}

INSTRUCTION FINALE
L'intention détectée est : ${intent.toUpperCase()}.
Respecte le mode prioritaire ci-dessus. Ne remplace pas une demande
explicite par un message d'accueil ou une liste de choix.
`;

  return { prompt, intent };
}

function buildParts({ prompt, image, document }) {
  const parts = [{ text: prompt }];

  function addFile(file, label) {
    if (!file || !file.data || !file.mimeType) {
      return;
    }

    const supportedTypes = [
      "image/jpeg",
      "image/png",
      "image/webp",
      "application/pdf"
    ];

    if (!supportedTypes.includes(file.mimeType)) {
      return;
    }

    parts.push({
      text: `\n${label} :`
    });

    parts.push({
      inlineData: {
        mimeType: file.mimeType,
        data: file.data
      }
    });
  }

  addFile(image, "Image fournie par l'élève");
  addFile(document, "Document PDF fourni par l'élève");

  return parts;
}

async function callGemini(apiKey, parts) {
  const url =
    `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent` +
    `?key=${encodeURIComponent(apiKey)}`;

  let lastError = null;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          contents: [{
            role: "user",
            parts
          }],
          generationConfig: {
            maxOutputTokens: 4096
          }
        })
      });

      if (response.ok) {
        const data = await response.json();

        const answer = data?.candidates?.[0]?.content?.parts
          ?.map(part => part.text || "")
          .join("")
          .trim();

        if (!answer) {
          throw new Error(
            "Klasévia n'a pas reçu de réponse exploitable."
          );
        }

        return answer;
      }

      const errorText = await response.text();

      console.error(
        `Erreur Gemini tentative ${attempt}/${MAX_ATTEMPTS} :`,
        response.status,
        errorText
      );

      const error = new Error(
        `Erreur du service Gemini (${response.status}).`
      );

      error.status = response.status;
      lastError = error;

      if (
        !RETRYABLE_STATUS_CODES.has(response.status) ||
        attempt === MAX_ATTEMPTS
      ) {
        break;
      }
    } catch (error) {
      lastError = error;

      console.error(
        `Erreur de connexion Gemini tentative ${attempt}/${MAX_ATTEMPTS} :`,
        error?.message
      );

      if (attempt === MAX_ATTEMPTS) {
        break;
      }
    }

    await sleep(1000 * Math.pow(2, attempt - 1));
  }

  if (lastError?.status && !RETRYABLE_STATUS_CODES.has(lastError.status)) {
    throw new Error(
      "Gemini a refusé la demande. Vérifie la configuration de l'API."
    );
  }

  throw new Error(
    "Le service pédagogique est temporairement indisponible. Réessaie dans quelques instants."
  );
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({
      error: "Méthode non autorisée."
    });
  }

  try {
    const body = req.body || {};

    /*
     * Le frontend actuel envoie "text".
     * "message" est conservé pour compatibilité.
     */
    const message = String(
      body.text ?? body.message ?? ""
    ).trim();

    const grade = String(body.grade || "");
    const subject = String(body.subject || "");
    const serie = String(body.serie || "");
    const theme = String(body.theme || "").trim();
    const difficulty = String(body.difficulty || "détaillé");
    const mode = String(body.mode || "explication");

    const history = Array.isArray(body.history)
      ? body.history
      : [];

    const image = body.image || null;
    const document = body.document || null;

    if (
      !message &&
      !image &&
      !document
    ) {
      return res.status(400).json({
        error: "Écris une question ou joins un fichier à analyser."
      });
    }

    const apiKey = process.env.GEMINI_API_KEY;

    if (!apiKey) {
      return res.status(500).json({
        error: "La clé API Gemini n'est pas configurée sur Vercel."
      });
    }

    const { prompt, intent } = buildPrompt({
      message,
      grade,
      subject,
      serie,
      theme,
      difficulty,
      mode,
      history
    });

    const parts = buildParts({
      prompt,
      image,
      document
    });

    console.log("Intention tutor détectée :", intent);

    const answer = await callGemini(apiKey, parts);

    return res.status(200).json({
      answer,
      intent
    });
  } catch (error) {
    console.error("Erreur API tutor :", error);

    return res.status(503).json({
      error: error?.message ||
        "Le service pédagogique est temporairement indisponible. Réessaie dans quelques instants."
    });
  }
}
