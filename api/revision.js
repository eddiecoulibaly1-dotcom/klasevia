const MODEL = "gemini-3.6-flash";

const ALLOWED_DIFFICULTIES = ["facile", "normal", "difficile"];

const revisionSchema = {
  type: "object",
  properties: {
    title: {
      type: "string",
      description: "Titre clair et précis de la fiche de révision."
    },
    objective: {
      type: "string",
      description: "Objectif pédagogique de la fiche."
    },
    essentialPoints: {
      type: "array",
      description: "Les notions essentielles à retenir.",
      items: {
        type: "string"
      }
    },
    definitions: {
      type: "array",
      description: "Définitions importantes liées au thème.",
      items: {
        type: "object",
        properties: {
          term: {
            type: "string"
          },
          definition: {
            type: "string"
          }
        },
        required: ["term", "definition"],
        additionalProperties: false
      }
    },
    rulesAndFormulas: {
      type: "array",
      description: "Règles, méthodes ou formules importantes. Pour les matières sans formules, fournir les règles ou méthodes essentielles.",
      items: {
        type: "object",
        properties: {
          name: {
            type: "string"
          },
          content: {
            type: "string"
          },
          example: {
            type: "string"
          }
        },
        required: ["name", "content", "example"],
        additionalProperties: false
      }
    },
    examples: {
      type: "array",
      description: "Exemples simples permettant de comprendre le cours.",
      items: {
        type: "object",
        properties: {
          title: {
            type: "string"
          },
          explanation: {
            type: "string"
          }
        },
        required: ["title", "explanation"],
        additionalProperties: false
      }
    },
    commonMistakes: {
      type: "array",
      description: "Erreurs fréquentes que les élèves doivent éviter.",
      items: {
        type: "string"
      }
    },
    quickSummary: {
      type: "string",
      description: "Résumé très court à mémoriser."
    },
    selfCheckQuestions: {
      type: "array",
      description: "Questions courtes permettant à l'élève de vérifier sa compréhension.",
      items: {
        type: "string"
      }
    }
  },
  required: [
    "title",
    "objective",
    "essentialPoints",
    "definitions",
    "rulesAndFormulas",
    "examples",
    "commonMistakes",
    "quickSummary",
    "selfCheckQuestions"
  ],
  additionalProperties: false
};

function cleanString(value, fallback = "") {
  if (typeof value !== "string") {
    return fallback;
  }

  return value.trim();
}

function normalizeDifficulty(value) {
  const difficulty = cleanString(value, "normal").toLowerCase();

  if (ALLOWED_DIFFICULTIES.includes(difficulty)) {
    return difficulty;
  }

  return "normal";
}

function normalizeArray(value) {
  return Array.isArray(value) ? value : [];
}

function validateRevision(revision) {
  if (!revision || typeof revision !== "object") {
    return false;
  }

  if (!cleanString(revision.title)) {
    return false;
  }

  if (!cleanString(revision.objective)) {
    return false;
  }

  if (!Array.isArray(revision.essentialPoints)) {
    return false;
  }

  if (!Array.isArray(revision.definitions)) {
    return false;
  }

  if (!Array.isArray(revision.rulesAndFormulas)) {
    return false;
  }

  if (!Array.isArray(revision.examples)) {
    return false;
  }

  if (!Array.isArray(revision.commonMistakes)) {
    return false;
  }

  if (!cleanString(revision.quickSummary)) {
    return false;
  }

  if (!Array.isArray(revision.selfCheckQuestions)) {
    return false;
  }

  return true;
}

function normalizeRevision(revision) {
  return {
    title: cleanString(revision.title),
    objective: cleanString(revision.objective),

    essentialPoints: normalizeArray(revision.essentialPoints)
      .map(item => cleanString(item))
      .filter(Boolean),

    definitions: normalizeArray(revision.definitions)
      .map(item => ({
        term: cleanString(item?.term),
        definition: cleanString(item?.definition)
      }))
      .filter(item => item.term && item.definition),

    rulesAndFormulas: normalizeArray(revision.rulesAndFormulas)
      .map(item => ({
        name: cleanString(item?.name),
        content: cleanString(item?.content),
        example: cleanString(item?.example)
      }))
      .filter(item => item.name && item.content),

    examples: normalizeArray(revision.examples)
      .map(item => ({
        title: cleanString(item?.title),
        explanation: cleanString(item?.explanation)
      }))
      .filter(item => item.title && item.explanation),

    commonMistakes: normalizeArray(revision.commonMistakes)
      .map(item => cleanString(item))
      .filter(Boolean),

    quickSummary: cleanString(revision.quickSummary),

    selfCheckQuestions: normalizeArray(revision.selfCheckQuestions)
      .map(item => cleanString(item))
      .filter(Boolean)
  };
}

function buildPrompt({
  classe,
  matiere,
  theme,
  serie,
  difficulty
}) {
  const safeSerie = serie || "Non précisée";

  return `
Tu es le moteur pédagogique officiel de Klasévia, une application éducative destinée principalement aux élèves de Côte d'Ivoire.

Ta mission est de créer UNE fiche de révision complète, fiable, claire et adaptée à l'élève.

INFORMATIONS DE L'ÉLÈVE :
- Classe : ${classe}
- Matière : ${matiere}
- Série : ${safeSerie}
- Thème : ${theme}
- Niveau demandé : ${difficulty}

OBJECTIF :
Créer une fiche permettant à l'élève de réviser rapidement le thème demandé et de retenir les connaissances essentielles.

RÈGLES PÉDAGOGIQUES :
1. Réponds en français.
2. Adapte réellement le contenu au niveau scolaire indiqué.
3. Utilise un vocabulaire simple et pédagogique.
4. Ne surcharge pas inutilement la fiche.
5. Commence par les notions fondamentales avant les notions plus complexes.
6. Donne des exemples concrets.
7. Pour les mathématiques et les sciences, vérifie soigneusement tous les calculs, formules et résultats.
8. Pour les matières littéraires, historiques, géographiques, philosophiques ou économiques, privilégie les notions, définitions, mécanismes et exemples réellement utiles pour les contrôles et examens.
9. Lorsque le programme ivoirien est pertinent, utilise naturellement des exemples adaptés au contexte de Côte d'Ivoire.
10. Ne prétends jamais qu'une information est au programme ivoirien si tu n'en es pas certain.
11. Ne crée aucune source, citation ou référence fictive.
12. Évite les informations hors sujet.
13. Les questions d'auto-évaluation doivent porter uniquement sur les connaissances réellement présentes dans la fiche.
14. Ne donne pas directement les réponses aux questions d'auto-évaluation.
15. La fiche doit être autonome : un élève doit pouvoir l'utiliser sans avoir besoin de lire une longue explication supplémentaire.

STRUCTURE ATTENDUE :
- Un titre précis.
- Un objectif pédagogique.
- Les points essentiels à retenir.
- Les définitions importantes.
- Les règles, méthodes ou formules.
- Des exemples expliqués.
- Les erreurs fréquentes.
- Un résumé express à mémoriser.
- Des questions courtes d'auto-évaluation.

IMPORTANT :
- Ne retourne aucun texte avant ou après le JSON.
- Retourne uniquement l'objet JSON correspondant au schéma demandé.
- Vérifie mentalement la cohérence et l'exactitude du contenu avant de répondre.
`;
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({
      error: "Méthode non autorisée. Utilisez POST."
    });
  }

  try {
    const apiKey = process.env.GEMINI_API_KEY;

    if (!apiKey) {
      return res.status(500).json({
        error: "La clé GEMINI_API_KEY est absente de l'environnement."
      });
    }

    const body = req.body || {};

    const classe = cleanString(body.classe);
    const matiere = cleanString(body.matiere);
    const theme = cleanString(body.theme);
    const serie = cleanString(body.serie, "Non précisée");
    const difficulty = normalizeDifficulty(body.difficulty);

    if (!classe) {
      return res.status(400).json({
        error: "La classe est obligatoire."
      });
    }

    if (!matiere) {
      return res.status(400).json({
        error: "La matière est obligatoire."
      });
    }

    if (!theme) {
      return res.status(400).json({
        error: "Le thème est obligatoire."
      });
    }

    if (theme.length > 300) {
      return res.status(400).json({
        error: "Le thème est trop long."
      });
    }

    const prompt = buildPrompt({
      classe,
      matiere,
      theme,
      serie,
      difficulty
    });

    const url =
      `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent` +
      `?key=${encodeURIComponent(apiKey)}`;

    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        contents: [
          {
            parts: [
              {
                text: prompt
              }
            ]
          }
        ],
        generationConfig: {
          responseMimeType: "application/json",
          responseSchema: revisionSchema,
          maxOutputTokens: 5000
        }
      })
    });

    const data = await response.json();

    if (!response.ok) {
      console.error("Gemini revision API error:", data);

      return res.status(response.status || 500).json({
        error:
          data?.error?.message ||
          "Une erreur est survenue lors de la génération de la fiche."
      });
    }

    const text =
      data?.candidates?.[0]?.content?.parts
        ?.map(part => part?.text || "")
        .join("")
        .trim();

    if (!text) {
      return res.status(502).json({
        error: "Gemini n'a retourné aucune fiche."
      });
    }

    let revision;

    try {
      revision = JSON.parse(text);
    } catch (parseError) {
      console.error("Revision JSON parse error:", parseError);
      console.error("Gemini raw response:", text);

      return res.status(502).json({
        error: "La fiche générée n'a pas pu être interprétée."
      });
    }

    if (!validateRevision(revision)) {
      console.error("Invalid revision structure:", revision);

      return res.status(502).json({
        error: "La fiche générée possède une structure invalide."
      });
    }

    const normalizedRevision = normalizeRevision(revision);

    return res.status(200).json({
      success: true,
      model: MODEL,
      classe,
      matiere,
      serie,
      theme,
      difficulty,
      revision: normalizedRevision
    });
  } catch (error) {
    console.error("Revision API unexpected error:", error);

    return res.status(500).json({
      error:
        error?.message ||
        "Une erreur interne est survenue lors de la génération de la fiche."
    });
  }
}