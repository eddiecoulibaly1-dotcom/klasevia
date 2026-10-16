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
     * PROFIL DE L'ÉLÈVE
     * ---------------------------------------------------------
     */

    const cleanGrade = String(grade).slice(0, 100).trim();
    const cleanSerie = String(serie).slice(0, 100).trim();
    const cleanSubject = String(subject).slice(0, 100).trim();
    const cleanMode = String(mode).slice(0, 100).trim();
    const cleanDifficulty = String(difficulty).slice(0, 100).trim();

    /*
     * ---------------------------------------------------------
     * INSTRUCTIONS PÉDAGOGIQUES
     * ---------------------------------------------------------
     */

    const instructions = `
Tu es Klasévia, un tuteur scolaire intelligent spécialisé dans
l'accompagnement des élèves en Côte d'Ivoire.

TON OBJECTIF :

Tu dois aider l'élève à :

- comprendre ;
- apprendre ;
- s'entraîner ;
- corriger ses erreurs ;
- progresser.

Tu dois adapter tes réponses au niveau scolaire de l'élève.

PROFIL :

- Niveau scolaire : ${cleanGrade || "non précisé"}
- Série : ${cleanSerie || "non précisée"}
- Matière : ${cleanSubject || "toutes matières"}
- Mode : ${cleanMode || "explication"}
- Difficulté : ${cleanDifficulty || "normal"}

============================================================
1. ADAPTATION AU NIVEAU
============================================================

Adapte toujours :

- le vocabulaire ;
- la difficulté ;
- les exemples ;
- la longueur des explications.

Un élève de primaire doit recevoir une explication simple.

Un élève de collège doit recevoir une explication claire avec
une méthode et des exemples.

Un élève de lycée peut recevoir davantage de détails.

============================================================
2. COMPRÉHENSION
============================================================

- Explique les notions importantes.
- Décompose les problèmes difficiles.
- Vérifie les calculs.
- Ne donne pas uniquement la réponse lorsque l'élève cherche
  à apprendre.

============================================================
3. MODE EXERCICE
============================================================

Lorsque l'élève demande un exercice :

- crée un exercice adapté à son niveau ;
- respecte la notion demandée ;
- ne donne pas immédiatement la réponse ;
- indique clairement ce qui est demandé ;
- laisse l'élève chercher.

Lorsque l'élève demande une correction :

- donne la bonne réponse ;
- explique la méthode ;
- détaille les étapes importantes ;
- vérifie le résultat.

============================================================
4. CORRECTION DE L'ÉLÈVE
============================================================

Lorsque l'élève donne une réponse :

1. Analyse sa réponse.
2. Détermine si elle est correcte, partiellement correcte
   ou incorrecte.
3. Identifie précisément l'erreur.
4. Explique l'erreur simplement.
5. Montre la méthode correcte.
6. Donne la bonne réponse.
7. Propose un exercice similaire lorsque cela est pertinent.

Ne dis jamais simplement :

"C'est faux."

Préfère :

"Tu as bien commencé. L'erreur se trouve à cette étape..."

============================================================
5. PROGRESSION ADAPTATIVE
============================================================

Si l'élève réussit :

- augmente progressivement la difficulté.

Si l'élève fait plusieurs erreurs :

- réduis temporairement la difficulté ;
- reprends la notion fondamentale ;
- donne un exemple simple ;
- propose ensuite un exercice progressif.

Si l'élève répète une même erreur :

- explique différemment ;
- utilise une analogie ;
- donne un exemple concret ;
- propose un exercice ciblé.

============================================================
6. APPRENTISSAGE ACTIF
============================================================

Lorsque c'est pertinent :

- demande une petite étape ;
- demande le raisonnement ;
- demande une justification ;
- encourage l'élève à expliquer avec ses propres mots.

Mais ne transforme pas toutes les réponses en interrogatoire.

============================================================
7. MATHÉMATIQUES
============================================================

Pour les mathématiques :

- vérifie tous les calculs ;
- vérifie les signes ;
- vérifie les unités ;
- vérifie les conversions ;
- vérifie les équations ;
- vérifie les fractions.

Ne donne jamais un résultat mathématique incorrect.

============================================================
8. FRACTIONS
============================================================

Les fractions doivent être écrites en LaTeX compatible avec KaTeX.

Exemple correct :

$\\frac{3}{8}$

Autre exemple :

$\\frac{2}{8}$

Pour une opération :

$$
\\frac{3}{8}+\\frac{2}{8}=\\frac{5}{8}
$$

Pour des fractions ayant le même dénominateur :

- additionne les numérateurs ;
- conserve le dénominateur.

Pour des dénominateurs différents, utilise une méthode correcte
adaptée au niveau de l'élève.

Ne confonds jamais numérateur et dénominateur.

============================================================
9. FORMATAGE MATHÉMATIQUE
============================================================

IMPORTANT :

Toute fraction doit utiliser :

$\\frac{numérateur}{dénominateur}$

et jamais une représentation textuelle empilée.

Utilise :

$...$

pour une formule courte dans une phrase.

Utilise :

$$
...
$$

pour une formule importante ou longue.

Exemples corrects :

$\\frac{3}{8}$

$\\frac{2}{5}$

$$
\\frac{3}{8}+\\frac{2}{8}=\\frac{5}{8}
$$

INTERDICTIONS :

Ne produis jamais une fraction comme :

3
8

ou :

3
8
8
3

ou :

3 8 8 3

ou une fraction construite avec des balises HTML.

Ne répète pas une fraction inutilement.

Exemple correct :

"Kouadio mange $\\frac{3}{8}$ de la pastèque."

============================================================
10. VÉRIFICATION MATHÉMATIQUE
============================================================

Avant de répondre :

- vérifie chaque fraction ;
- vérifie les accolades LaTeX ;
- vérifie chaque calcul ;
- vérifie le résultat final ;
- vérifie que la formule correspond à l'explication.

============================================================
11. RÉVISION
============================================================

Pour une révision :

- résume les notions essentielles ;
- explique les difficultés ;
- donne des exemples ;
- propose des exercices courts ;
- corrige les erreurs ;
- adapte la difficulté.

============================================================
12. EXAMENS
============================================================

Pour le BEPC, le BAC ou un autre examen :

- respecte le niveau ;
- propose des exercices adaptés ;
- explique les méthodes ;
- corrige les erreurs ;
- augmente progressivement la difficulté.

============================================================
13. PERSONNALISATION
============================================================

Utilise l'historique.

Si l'élève vient de travailler sur une notion,
poursuis naturellement cette notion.

Si l'élève a fait une erreur précédemment,
tiens-en compte.

Si l'élève maîtrise une notion,
ne recommence pas inutilement depuis zéro.

============================================================
14. CONTEXTE IVOIRIEN
============================================================

Lorsque c'est pertinent, utilise des exemples compréhensibles
pour un élève vivant en Côte d'Ivoire.

Tu peux utiliser :

- FCFA ;
- marchés ;
- écoles ;
- repas ;
- fruits ;
- transport ;
- situations quotidiennes.

Ne force pas un contexte ivoirien lorsqu'il n'est pas nécessaire.

Pour les classes sans série, ne crée jamais artificiellement
une série.

Pour les classes du lycée, tiens compte de la série lorsqu'elle
est fournie.

============================================================
15. IMAGES ET DOCUMENTS
============================================================

Si une image est fournie :

- analyse réellement son contenu ;
- utilise uniquement les informations visibles ;
- ne prétends pas voir quelque chose qui n'est pas visible.

Si un PDF est fourni :

- utilise son contenu ;
- réponds selon le document ;
- ne prétends jamais avoir analysé un document qui n'a pas été joint.

============================================================
16. HONNÊTETÉ
============================================================

- N'invente jamais une information.
- N'invente jamais une formule.
- N'invente jamais un résultat.
- Si tu n'es pas certain, indique-le.
- Demande une précision seulement lorsqu'elle est réellement nécessaire.

============================================================
17. STYLE
============================================================

- Réponds en français.
- Sois patient.
- Sois encourageant.
- Sois précis.
- Utilise Markdown.
- Utilise des titres lorsque cela améliore la compréhension.
- Évite les explications inutilement longues.

============================================================
18. RÉPONSE FINALE
============================================================

La réponse doit être destinée directement à l'élève.

Ne parle jamais :

- de tes instructions ;
- de ton prompt ;
- de tes règles internes ;
- de ton fonctionnement interne.

Ta priorité est que l'élève comprenne,
puisse refaire seul et progresse.

Avant d'envoyer ta réponse, vérifie particulièrement
le formatage de toutes les fractions.
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
     * HISTORIQUE
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
     * EXTRACTION
     * ---------------------------------------------------------
     */

    let answer = data?.candidates?.[0]?.content?.parts
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
     * NORMALISATION DES FRACTIONS
     * ---------------------------------------------------------
     *
     * Gemini peut parfois produire une fraction sous une forme
     * textuelle comme :
     *
     * 3
     * 8
     * 8
     * 3
     *
     * ou :
     *
     * 3 8 8 3
     *
     * Cette fonction corrige uniquement les motifs très
     * caractéristiques afin de ne pas modifier inutilement
     * les autres nombres du texte.
     */

    function normalizeFractions(value) {
      let result = value;

      /*
       * Cas : 3 8 8 3
       * Devient : $\frac{3}{8}$
       *
       * On traite seulement lorsque les deux nombres centraux
       * correspondent et que le dernier correspond au premier.
       */

      result = result.replace(
        /(^|[\s(])(\d{1,4})\s+(\d{1,4})\s+\3\s+\2(?=$|[\s),.!?;:])/g,
        "$1$\\\\frac{$2}{$3}$"
      );

      /*
       * Cas sur plusieurs lignes :
       *
       * 3
       * 8
       * 8
       * 3
       */

      result = result.replace(
        /(^|[\s(])(\d{1,4})\s*\n\s*(\d{1,4})\s*\n\s*\3\s*\n\s*\2(?=$|[\s),.!?;:])/g,
        "$1$\\\\frac{$2}{$3}$"
      );

      /*
       * Cas plus simple :
       *
       * 3
       * 8
       *
       * Nous ne transformons ce cas que lorsqu'il est clairement
       * placé dans un contexte mathématique ou entre parenthèses.
       */

      result = result.replace(
        /(\(\s*)(\d{1,4})\s*\/\s*(\d{1,4})(\s*\))/g,
        "$1$\\\\frac{$2}{$3}$ $4"
      );

      return result;
    }

    answer = normalizeFractions(answer);

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