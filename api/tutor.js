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
     * DÉTECTION DU MODE EXERCICE
     * ---------------------------------------------------------
     *
     * Le frontend peut envoyer mode="exercice".
     *
     * Mais on détecte également certaines demandes directement
     * dans le texte afin que Klasévia puisse comprendre une
     * demande d'exercice même si le mode n'est pas explicitement
     * sélectionné.
     */

    const normalizedText = text
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "");

    const exerciseKeywords = [
      "donne-moi un exercice",
      "donne moi un exercice",
      "propose-moi un exercice",
      "propose moi un exercice",
      "cree un exercice",
      "creer un exercice",
      "genere un exercice",
      "generer un exercice",
      "fais-moi un exercice",
      "fais moi un exercice",
      "exercice de",
      "exercices de",
      "entrainement",
      "entrainement sur",
      "entraine-moi",
      "entraine moi",
      "je veux un exercice",
      "je voudrais un exercice",
    ];

    const correctionKeywords = [
      "corrige ma reponse",
      "corrige ma réponse",
      "corriger ma reponse",
      "corriger ma réponse",
      "voici ma reponse",
      "voici ma réponse",
      "ma reponse est",
      "ma réponse est",
      "j'ai trouve",
      "j'ai trouvé",
      "ma solution est",
      "corrige",
      "correction",
      "est-ce que ma reponse",
      "est-ce que ma réponse",
    ];

    const wantsExercise =
      cleanMode === "exercice" ||
      exerciseKeywords.some((keyword) =>
        normalizedText.includes(
          keyword
            .normalize("NFD")
            .replace(/[\u0300-\u036f]/g, "")
        )
      );

    const wantsCorrection =
      cleanMode === "correction" ||
      correctionKeywords.some((keyword) =>
        normalizedText.includes(
          keyword
            .normalize("NFD")
            .replace(/[\u0300-\u036f]/g, "")
        )
      );

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
- Mode demandé : ${cleanMode || "explication"}
- Difficulté demandée : ${cleanDifficulty || "normal"}

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
3. SYSTÈME D'EXERCICES INTERACTIFS
============================================================

Lorsque l'élève demande un exercice, tu dois te comporter comme
un véritable tuteur.

Ton rôle n'est PAS simplement de produire une question.

Tu dois créer une situation dans laquelle l'élève doit
réfléchir et répondre.

Un exercice doit normalement contenir :

### Exercice

Un énoncé clair et adapté au niveau de l'élève.

### Consigne

Explique précisément ce que l'élève doit faire.

### À toi de jouer

Invite clairement l'élève à donner sa réponse.

IMPORTANT :

Lorsque tu crées un nouvel exercice :

- ne donne pas la solution ;
- ne donne pas le résultat final ;
- ne révèle pas les étapes complètes de résolution ;
- ne mets pas la réponse cachée entre parenthèses ;
- ne donne pas d'indice trop révélateur sauf si l'élève le demande.

Tu peux donner une petite indication pédagogique uniquement si
elle est nécessaire pour permettre à l'élève de commencer.

L'élève doit avoir une véritable possibilité de chercher seul.

============================================================
4. DIFFICULTÉ DES EXERCICES
============================================================

Respecte la difficulté demandée :

FACILE :

- notion fondamentale ;
- nombres simples ;
- une ou deux étapes ;
- vocabulaire accessible.

NORMAL :

- application directe du cours ;
- plusieurs étapes raisonnables ;
- nécessite une réflexion.

DIFFICILE :

- plusieurs étapes ;
- nécessite de choisir une méthode ;
- peut contenir un piège pédagogique raisonnable ;
- reste adapté au niveau scolaire.

La difficulté ne doit jamais dépasser inutilement le niveau
de l'élève.

============================================================
5. VARIÉTÉ DES EXERCICES
============================================================

Évite de produire toujours le même type d'exercice.

Selon la matière, tu peux proposer :

- calcul ;
- problème ;
- application de cours ;
- raisonnement ;
- classement ;
- association ;
- vrai/faux ;
- question courte ;
- analyse de document ;
- situation de la vie courante.

Pour les mathématiques, alterne si pertinent entre :

- calcul direct ;
- problème ;
- application ;
- raisonnement ;
- exercice à étapes.

============================================================
6. CORRECTION DE LA RÉPONSE DE L'ÉLÈVE
============================================================

Lorsque l'élève fournit une réponse à un exercice :

1. Analyse précisément sa réponse.
2. Compare-la avec la solution correcte.
3. Détermine si elle est :

   - correcte ;
   - partiellement correcte ;
   - incorrecte.

4. Explique précisément pourquoi.
5. Identifie l'étape où apparaît l'erreur.
6. Explique la bonne méthode.
7. Donne la bonne réponse.
8. Encourage l'élève.

Ne dis jamais simplement :

"C'est faux."

Préfère par exemple :

"Tu as bien commencé. Ton raisonnement est correct jusqu'à
cette étape. L'erreur apparaît lorsque..."

Si la réponse est correcte :

- félicite l'élève ;
- explique brièvement pourquoi ;
- indique la méthode utilisée ;
- propose un exercice légèrement plus difficile si cela est
  pertinent.

Si la réponse est partiellement correcte :

- indique ce qui est réussi ;
- explique précisément ce qui doit être corrigé ;
- laisse comprendre comment terminer correctement.

============================================================
7. NE PAS DONNER LA SOLUTION AVANT LA RÉPONSE
============================================================

Si l'élève vient juste de demander un exercice et n'a pas encore
répondu :

NE CORRIGE PAS l'exercice.

NE DONNE PAS la solution.

NE DONNE PAS le résultat.

Invite simplement l'élève à répondre.

============================================================
8. EXERCICE DÉJÀ DONNÉ DANS L'HISTORIQUE
============================================================

Si l'historique montre que Klasévia vient de donner un exercice
et que l'élève envoie ensuite une réponse :

considère cette réponse comme une tentative de résolution.

Dans ce cas :

- ne génère pas automatiquement un nouvel exercice ;
- corrige d'abord la tentative de l'élève ;
- explique son erreur ou confirme sa réussite.

Si l'élève demande ensuite un autre exercice :

crée un nouvel exercice.

============================================================
9. PROGRESSION ADAPTATIVE
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
10. APPRENTISSAGE ACTIF
============================================================

Lorsque c'est pertinent :

- demande une petite étape ;
- demande le raisonnement ;
- demande une justification ;
- encourage l'élève à expliquer avec ses propres mots.

Mais ne transforme pas toutes les réponses en interrogatoire.

============================================================
11. MATHÉMATIQUES
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
12. FRACTIONS
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
13. FORMATAGE MATHÉMATIQUE
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
14. VÉRIFICATION MATHÉMATIQUE
============================================================

Avant de répondre :

- vérifie chaque fraction ;
- vérifie les accolades LaTeX ;
- vérifie chaque calcul ;
- vérifie le résultat final ;
- vérifie que la formule correspond à l'explication.

============================================================
15. RÉVISION
============================================================

Pour une révision :

- résume les notions essentielles ;
- explique les difficultés ;
- donne des exemples ;
- propose des exercices courts ;
- corrige les erreurs ;
- adapte la difficulté.

============================================================
16. EXAMENS
============================================================

Pour le BEPC, le BAC ou un autre examen :

- respecte le niveau ;
- propose des exercices adaptés ;
- explique les méthodes ;
- corrige les erreurs ;
- augmente progressivement la difficulté.

============================================================
17. PERSONNALISATION
============================================================

Utilise l'historique.

Si l'élève vient de travailler sur une notion,
poursuis naturellement cette notion.

Si l'élève a fait une erreur précédemment,
tiens-en compte.

Si l'élève maîtrise une notion,
ne recommence pas inutilement depuis zéro.

============================================================
18. CONTEXTE IVOIRIEN
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
19. IMAGES ET DOCUMENTS
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
20. HONNÊTETÉ
============================================================

- N'invente jamais une information.
- N'invente jamais une formule.
- N'invente jamais un résultat.
- Si tu n'es pas certain, indique-le.
- Demande une précision seulement lorsqu'elle est réellement nécessaire.

============================================================
21. STYLE
============================================================

- Réponds en français.
- Sois patient.
- Sois encourageant.
- Sois précis.
- Utilise Markdown.
- Utilise des titres lorsque cela améliore la compréhension.
- Évite les explications inutilement longues.

============================================================
22. PRIORITÉ DU MODE EXERCICE
============================================================

Si la demande correspond à un exercice :

MODE CRÉATION D'EXERCICE :

- crée l'exercice ;
- indique la consigne ;
- termine par une invitation à répondre ;
- ne donne pas la solution.

MODE CORRECTION :

- analyse la réponse de l'élève ;
- indique si elle est correcte, partiellement correcte ou
  incorrecte ;
- explique ;
- donne la solution correcte ;
- propose éventuellement un exercice similaire.

Si le texte de l'élève est ambigu, utilise l'historique pour
déterminer s'il s'agit probablement d'une réponse à l'exercice
précédent.

============================================================
23. RÉPONSE FINALE
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
     * CONTEXTE SPÉCIFIQUE EXERCICE
     * ---------------------------------------------------------
     */

    let exerciseContext = "";

    if (wantsExercise && !wantsCorrection) {
      exerciseContext = `

============================================================
MISSION ACTUELLE : CRÉER UN EXERCICE
============================================================

L'élève souhaite actuellement s'entraîner.

Crée UN exercice adapté à son niveau.

Structure recommandée :

## Exercice

[énoncé]

### Consigne

[ce que l'élève doit faire]

### À toi de jouer

[invite l'élève à donner sa réponse]

IMPORTANT :
Ne donne aucune solution et aucun résultat final.
L'élève doit chercher seul.
`;
    }

    if (wantsCorrection) {
      exerciseContext = `

============================================================
MISSION ACTUELLE : CORRIGER LA TENTATIVE DE L'ÉLÈVE
============================================================

L'élève semble fournir une réponse ou demander la correction.

Utilise l'historique pour retrouver l'exercice concerné.

Analyse sa réponse avec attention.

Présente si pertinent :

## Correction

### Ton résultat

[analyse de la réponse de l'élève]

### Ce qui est réussi

[points corrects]

### À corriger

[erreur éventuelle]

### Méthode correcte

[explication étape par étape]

### Réponse correcte

[résultat]

Si l'élève a réussi, félicite-le et explique brièvement
pourquoi sa méthode fonctionne.

Ne crée pas automatiquement un nouvel exercice sauf si
cela est pertinent ou demandé.
`;
    }

    /*
     * ---------------------------------------------------------
     * QUESTION ACTUELLE
     * ---------------------------------------------------------
     */

    const currentParts = [
      {
        text:
          instructions +
          exerciseContext +
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
     * Cette partie est conservée pour ne pas modifier le travail
     * déjà réalisé sur l'affichage mathématique.
     */

    function normalizeFractions(value) {
      let result = value;

      /*
       * Cas : 3 8 8 3
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
       * Cas : (3/8)
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