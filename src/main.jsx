import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import ReactMarkdown from "react-markdown";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import "katex/dist/katex.min.css";
import "./style.css";

const CLASSES = [
  "CP1", "CP2", "CE1", "CE2", "CM1", "CM2",
  "6e", "5e", "4e", "3e", "Seconde", "Première", "Terminale"
];

const SUBJECTS = [
  "Mathématiques", "Français", "Anglais", "Physique-Chimie",
  "SVT", "Histoire-Géographie", "Philosophie", "Informatique",
  "Économie", "Éducation civique", "Autre"
];

const SERIES = [
  "Non précisée", "Tronc commun", "A1", "A2", "C", "D",
  "A", "F", "G", "Autre"
];

const GRADES_WITHOUT_SERIES = [
  "CP1", "CP2", "CE1", "CE2", "CM1", "CM2",
  "6e", "5e", "4e", "3e"
];

function gradeHasSeries(grade) {
  return !GRADES_WITHOUT_SERIES.includes(grade);
}

function normalizeSerie(grade, serie) {
  return gradeHasSeries(grade)
    ? (serie || "Non précisée")
    : "Non précisée";
}

const SPEED = 1.25;
const MAX_PDF_SIZE = 3 * 1024 * 1024;
const MAX_IMAGE_SIZE = 4 * 1024 * 1024;
const MAX_TEXT_SIZE = 100 * 1024;
const STORAGE_KEY = "klasevia-conversations-v1";
const MAX_SAVED_CONVERSATIONS = 50;

function makeId() {
  return `${Date.now()}-${Math.random()
    .toString(36)
    .slice(2, 10)}`;
}

/*
 * ============================================================
 * QUIZ
 * ============================================================
 */

function isQuizStartRequest(value) {
  const text = String(value || "")
    .trim()
    .toLowerCase();

  if (!text) {
    return false;
  }

  const patterns = [
    /\bquiz\b/,
    /\bqcm\b/,
    /fais[- ]moi un quiz/,
    /fait[- ]moi un quiz/,
    /donne[- ]moi un quiz/,
    /commence[- ]moi un quiz/,
    /lance[- ]moi un quiz/,
    /teste[- ]moi/,
    /teste moi/,
    /fais[- ]moi un test/,
    /fait[- ]moi un test/,
    /donne[- ]moi un test/,
    /je veux un quiz/,
    /je veux un test/
  ];

  return patterns.some(
    pattern => pattern.test(text)
  );
}

function isQuizStopRequest(value) {
  const text = String(value || "")
    .trim()
    .toLowerCase();

  if (!text) {
    return false;
  }

  const patterns = [
    /arrête le quiz/,
    /arrete le quiz/,
    /terminer le quiz/,
    /termine le quiz/,
    /fin du quiz/,
    /stop quiz/,
    /quitte le quiz/
  ];

  return patterns.some(
    pattern => pattern.test(text)
  );
}

function makeConversation(settings = {}) {
  const grade = settings.grade || "Terminale";

  const serie = normalizeSerie(
    grade,
    settings.serie || "D"
  );

  const now = new Date().toISOString();

  return {
    id: makeId(),
    title: "Nouvelle conversation",
    createdAt: now,
    updatedAt: now,
    grade,
    serie,
    subject:
      settings.subject || "Mathématiques",
    difficulty:
      settings.difficulty || "détaillé",
    mode:
      settings.mode || "explication",
    quizState: null,
    messages: []
  };
}

function normalizeConversation(conversation) {
  if (
    !conversation ||
    typeof conversation !== "object"
  ) {
    return null;
  }

  const grade =
    conversation.grade || "Terminale";

  return {
    ...conversation,
    grade,

    serie: normalizeSerie(
      grade,
      conversation.serie
    ),

    subject:
      conversation.subject ||
      "Mathématiques",

    difficulty:
      conversation.difficulty ||
      "détaillé",

    mode:
      conversation.mode ||
      "explication",

    quizState:
      conversation.quizState || null,

    messages:
      Array.isArray(conversation.messages)
        ? conversation.messages
        : []
  };
}

function loadSavedData() {
  try {
    const raw =
      localStorage.getItem(
        STORAGE_KEY
      );

    if (!raw) {
      const first =
        makeConversation();

      return {
        conversations: [first],
        activeId: first.id
      };
    }

    const parsed =
      JSON.parse(raw);

    const conversations =
      Array.isArray(
        parsed.conversations
      )
        ? parsed.conversations
            .filter(
              c =>
                c &&
                typeof c.id ===
                  "string" &&
                Array.isArray(
                  c.messages
                )
            )
            .map(
              normalizeConversation
            )
            .filter(Boolean)
            .slice(
              0,
              MAX_SAVED_CONVERSATIONS
            )
        : [];

    if (conversations.length) {
      const activeId =
        conversations.some(
          c =>
            c.id ===
            parsed.activeId
        )
          ? parsed.activeId
          : conversations[0].id;

      return {
        conversations,
        activeId
      };
    }
  } catch (_) {
    // Historique illisible :
    // on repart sur une conversation propre.
  }

  const first =
    makeConversation();

  return {
    conversations: [first],
    activeId: first.id
  };
}

function getSpeechRecognition() {
  if (
    typeof window ===
    "undefined"
  ) {
    return null;
  }

  return (
    window.SpeechRecognition ||
    window.webkitSpeechRecognition ||
    null
  );
}

function chooseFrenchVoice(voices) {
  const french =
    voices.filter(v =>
      /^fr([-_]|$)/i.test(
        v.lang || ""
      )
    );

  return (
    french.find(v =>
      /natural|naturel|neural|premium|enhanced/i.test(
        v.name
      )
    ) ||
    french.find(v =>
      /^fr-FR$/i.test(
        v.lang
      )
    ) ||
    french[0] ||
    null
  );
}

function splitSpeech(
  text,
  maxLength = 220
) {
  const cleaned = text
    .replace(
      /```[\s\S]*?```/g,
      " bloc de code omis "
    )
    .replace(
      /!\[[^\]]*\]\([^)]*\)/g,
      ""
    )
    .replace(
      /\[([^\]]+)\]\([^)]*\)/g,
      "$1"
    )
    .replace(
      /(\$|\\\[|\\\])/g,
      " "
    )
    .replace(
      /[*_#`>|]/g,
      " "
    )
    .replace(
      /\s+/g,
      " "
    )
    .trim();

  if (!cleaned) {
    return [];
  }

  const sentences =
    cleaned.match(
      /[^.!?]+[.!?]+|[^.!?]+$/g
    ) || [cleaned];

  const chunks = [];
  let current = "";

  for (const sentence of sentences) {
    const part =
      sentence.trim();

    if (!part) {
      continue;
    }

    if (
      (
        current +
        " " +
        part
      ).trim().length <=
      maxLength
    ) {
      current = (
        current +
        " " +
        part
      ).trim();
    } else {
      if (current) {
        chunks.push(current);
      }

      if (
        part.length <=
        maxLength
      ) {
        current = part;
      } else {
        current = "";

        for (const word of part.split(
          /\s+/
        )) {
          if (
            (
              current +
              " " +
              word
            ).trim().length >
            maxLength
          ) {
            if (current) {
              chunks.push(
                current
              );
            }

            current = word;
          } else {
            current = (
              current +
              " " +
              word
            ).trim();
          }
        }
      }
    }
  }

  if (current) {
    chunks.push(current);
  }

  return chunks;
}

function readAsDataURL(file) {
  return new Promise(
    (resolve, reject) => {
      const reader =
        new FileReader();

      reader.onload = () =>
        resolve(
          String(
            reader.result
          )
        );

      reader.onerror = () =>
        reject(
          new Error(
            "Lecture du fichier impossible."
          )
        );

      reader.readAsDataURL(
        file
      );
    }
  );
}

function formatDate(value) {
  try {
    return new Date(
      value
    ).toLocaleString(
      "fr-FR",
      {
        day: "2-digit",
        month: "short",
        hour: "2-digit",
        minute: "2-digit"
      }
    );
  } catch (_) {
    return "";
  }
}

function App() {
  const [savedData, setSavedData] =
    useState(loadSavedData);

  const [grade, setGrade] =
    useState("Terminale");

  const [serie, setSerie] =
    useState("D");

  const [subject, setSubject] =
    useState("Mathématiques");

  const [difficulty, setDifficulty] =
    useState("détaillé");

  const [mode, setMode] =
    useState("explication");

  const [text, setText] =
    useState("");

  const [image, setImage] =
    useState(null);

  const [imagePreview, setImagePreview] =
    useState("");

  const [document, setDocument] =
    useState(null);

  const [documentText, setDocumentText] =
    useState("");

  const [fileName, setFileName] =
    useState("");

  const [loading, setLoading] =
    useState(false);

  const [
    loadingConversationId,
    setLoadingConversationId
  ] = useState(null);

  const [error, setError] =
    useState("");

  const [speaking, setSpeaking] =
    useState(false);

  const [listening, setListening] =
    useState(false);

  const [voiceStatus, setVoiceStatus] =
    useState("");

  const [availableVoice, setAvailableVoice] =
    useState("");

  const [voiceSupported, setVoiceSupported] =
    useState(false);

  const [
    recognitionSupported,
    setRecognitionSupported
  ] = useState(false);

  /*
   * Nouveau :
   * mémorise le message qui vient
   * d'être copié pour afficher
   * "Copié !"
   */
  const [copiedMessageId, setCopiedMessageId] =
    useState(null);

  const fileInputRef =
    useRef(null);

  const recognitionRef =
    useRef(null);

  const speechRunRef =
    useRef(0);

  const speechQueueRef =
    useRef([]);

  const speechIndexRef =
    useRef(0);

  const conversations =
    savedData.conversations;

  const activeConversation =
    conversations.find(
      c =>
        c.id ===
        savedData.activeId
    ) || conversations[0];

  const messages =
    activeConversation?.messages ||
    [];

  const activeQuiz =
    activeConversation?.quizState ||
    null;

  const answer =
    [...messages]
      .reverse()
      .find(
        m =>
          m.role ===
          "assistant"
      )?.content || "";

  useEffect(() => {
    try {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify(
          savedData
        )
      );
    } catch (_) {
      setError(
        "L'historique ne peut pas être enregistré. L'espace de stockage du navigateur est peut-être plein."
      );
    }
  }, [savedData]);

  useEffect(() => {
    const synth =
      window.speechSynthesis;

    const Recognition =
      getSpeechRecognition();

    setVoiceSupported(
      Boolean(
        synth &&
          window.SpeechSynthesisUtterance
      )
    );

    setRecognitionSupported(
      Boolean(Recognition)
    );

    function updateVoice() {
      if (!synth) {
        return;
      }

      const voice =
        chooseFrenchVoice(
          synth.getVoices()
        );

      setAvailableVoice(
        voice
          ? `${voice.name} (${voice.lang})`
          : "Voix française non détectée"
      );
    }

    if (synth) {
      updateVoice();

      synth.addEventListener?.(
        "voiceschanged",
        updateVoice
      );
    }

    return () => {
      speechRunRef.current++;

      synth?.cancel();

      synth?.removeEventListener?.(
        "voiceschanged",
        updateVoice
      );

      try {
        recognitionRef.current?.stop();
      } catch (_) {}
    };
  }, []);

  function updateConversation(
    id,
    updater
  ) {
    setSavedData(
      previous => ({
        ...previous,
        conversations:
          previous.conversations.map(
            c =>
              c.id === id
                ? updater(c)
                : c
          )
      })
    );
  }

  /*
   * ============================================================
   * COPIE EN UN CLIC
   * ============================================================
   */

  async function copyResponse(
    messageId,
    content
  ) {
    if (!content?.trim()) {
      return;
    }

    try {
      if (
        navigator.clipboard &&
        window.isSecureContext
      ) {
        await navigator.clipboard.writeText(
          content
        );
      } else {
        const textarea =
          document.createElement(
            "textarea"
          );

        textarea.value =
          content;

        textarea.style.position =
          "fixed";
        textarea.style.left =
          "-9999px";

        document.body.appendChild(
          textarea
        );

        textarea.focus();
        textarea.select();

        document.execCommand(
          "copy"
        );

        document.body.removeChild(
          textarea
        );
      }

      setCopiedMessageId(
        messageId
      );

      window.setTimeout(() => {
        setCopiedMessageId(
          current =>
            current ===
            messageId
              ? null
              : current
        );
      }, 1600);
    } catch (_) {
      setError(
        "Impossible de copier cette réponse. Essaie à nouveau."
      );
    }
  }

  function stopSpeaking() {
    speechRunRef.current++;

    speechQueueRef.current =
      [];

    speechIndexRef.current =
      0;

    window.speechSynthesis?.cancel();

    setSpeaking(false);
    setVoiceStatus("");
  }

  function speakNext(runId) {
    if (
      runId !==
      speechRunRef.current
    ) {
      return;
    }

    const synth =
      window.speechSynthesis;

    const chunks =
      speechQueueRef.current;

    if (
      speechIndexRef.current >=
      chunks.length
    ) {
      setSpeaking(false);
      setVoiceStatus("");
      return;
    }

    const utterance =
      new SpeechSynthesisUtterance(
        chunks[
          speechIndexRef.current
        ]
      );

    const voice =
      chooseFrenchVoice(
        synth.getVoices()
      );

    utterance.lang =
      voice?.lang ||
      "fr-FR";

    if (voice) {
      utterance.voice =
        voice;
    }

    utterance.rate = SPEED;
    utterance.pitch = 1.05;
    utterance.volume = 1;

    utterance.onend = () => {
      if (
        runId !==
        speechRunRef.current
      ) {
        return;
      }

      speechIndexRef.current++;

      speakNext(runId);
    };

    utterance.onerror = event => {
      if (
        runId !==
        speechRunRef.current
      ) {
        return;
      }

      if (
        event.error ===
          "canceled" ||
        event.error ===
          "interrupted"
      ) {
        return;
      }

      setSpeaking(false);

      setVoiceStatus(
        "La lecture a rencontré un problème. Réessaie."
      );
    };

    synth.speak(
      utterance
    );
  }

  function startSpeaking(
    content = answer
  ) {
    if (!content.trim()) {
      setVoiceStatus(
        "Aucune réponse à lire pour le moment."
      );

      return;
    }

    if (
      !(
        "speechSynthesis" in
        window
      )
    ) {
      setVoiceStatus(
        "La lecture vocale n'est pas disponible dans ce navigateur."
      );

      return;
    }

    stopSpeaking();

    const runId =
      speechRunRef.current;

    speechQueueRef.current =
      splitSpeech(content);

    speechIndexRef.current =
      0;

    if (
      !speechQueueRef.current
        .length
    ) {
      setVoiceStatus(
        "Aucun texte lisible dans cette réponse."
      );

      return;
    }

    setSpeaking(true);

    setVoiceStatus(
      `Lecture en cours à ${SPEED}×`
    );

    speakNext(runId);
  }

  function toggleListening() {
    if (listening) {
      try {
        recognitionRef.current?.stop();
      } catch (_) {}

      setListening(false);
      setVoiceStatus("");

      return;
    }

    const Recognition =
      getSpeechRecognition();

    if (!Recognition) {
      setVoiceStatus(
        "Utilise le microphone du clavier Android pour dicter ta question."
      );

      return;
    }

    stopSpeaking();

    const recognition =
      new Recognition();

    recognition.lang =
      "fr-FR";

    recognition.continuous =
      false;

    recognition.interimResults =
      true;

    recognition.maxAlternatives =
      1;

    recognitionRef.current =
      recognition;

    let finalTranscript = "";

    recognition.onstart = () => {
      setListening(true);

      setVoiceStatus(
        "Je t'écoute. Parle maintenant."
      );
    };

    recognition.onresult =
      event => {
        let interim = "";

        for (
          let i =
            event.resultIndex;
          i <
          event.results.length;
          i++
        ) {
          const result =
            event.results[i];

          if (
            result.isFinal
          ) {
            finalTranscript +=
              result[0]
                .transcript +
              " ";
          } else {
            interim +=
              result[0]
                .transcript;
          }
        }

        setText(
          (
            finalTranscript +
            interim
          ).trim()
        );
      };

    recognition.onerror =
      event => {
        setListening(false);

        setVoiceStatus(
          event.error ===
            "not-allowed"
            ? "Autorise le microphone dans les paramètres du navigateur."
            : "La reconnaissance vocale a échoué. Réessaie."
        );
      };

    recognition.onend = () => {
      setListening(false);

      setVoiceStatus(
        finalTranscript.trim()
          ? "Ta question vocale a été transcrite."
          : ""
      );
    };

    try {
      recognition.start();
    } catch (_) {
      setListening(false);

      setVoiceStatus(
        "Impossible de démarrer le microphone. Réessaie."
      );
    }
  }

  async function handleFile(
    file
  ) {
    setError("");

    if (!file) {
      return;
    }

    const type =
      file.type;

    const name =
      file.name ||
      "document";

    const lowerName =
      name.toLowerCase();

    try {
      if (
        type ===
          "application/pdf" ||
        lowerName.endsWith(
          ".pdf"
        )
      ) {
        if (
          file.size >
          MAX_PDF_SIZE
        ) {
          setError(
            "Le PDF doit peser 3 Mo maximum. Essaie de le compresser."
          );

          return;
        }

        const dataUrl =
          await readAsDataURL(
            file
          );

        setDocument({
          name,
          mimeType:
            "application/pdf",
          data:
            dataUrl.split(
              ","
            )[1]
        });

        setDocumentText("");
        setImage(null);
        setImagePreview("");
        setFileName(name);

        return;
      }

      if (
        type ===
          "text/plain" ||
        lowerName.endsWith(
          ".txt"
        )
      ) {
        if (
          file.size >
          MAX_TEXT_SIZE
        ) {
          setError(
            "Le fichier texte doit peser 100 Ko maximum."
          );

          return;
        }

        const content =
          await file.text();

        setDocument(null);
        setDocumentText(
          content
        );
        setImage(null);
        setImagePreview("");
        setFileName(name);

        return;
      }

      const imageTypes = [
        "image/jpeg",
        "image/png",
        "image/webp"
      ];

      if (
        imageTypes.includes(
          type
        )
      ) {
        if (
          file.size >
          MAX_IMAGE_SIZE
        ) {
          setError(
            "L'image doit peser 4 Mo maximum."
          );

          return;
        }

        const dataUrl =
          await readAsDataURL(
            file
          );

        setImage({
          data:
            dataUrl.split(
              ","
            )[1],
          mimeType: type
        });

        setImagePreview(
          dataUrl
        );

        setDocument(null);
        setDocumentText("");
        setFileName(name);

        return;
      }

      setError(
        "Format non pris en charge. Choisis un PDF, un fichier TXT ou une image JPG, PNG ou WebP."
      );
    } catch (_) {
      setError(
        "Impossible de lire ce fichier. Essaie un autre document."
      );
    }
  }

  function removeFile() {
    setImage(null);
    setImagePreview("");
    setDocument(null);
    setDocumentText("");
    setFileName("");

    if (fileInputRef.current) {
      fileInputRef.current.value =
        "";
    }
  }

  function createNewConversation() {
    stopSpeaking();

    try {
      recognitionRef.current?.stop();
    } catch (_) {}

    const conversation =
      makeConversation({
        grade,
        serie,
        subject,
        difficulty,
        mode
      });

    setSavedData(
      previous => ({
        conversations: [
          conversation,
          ...previous.conversations
        ].slice(
          0,
          MAX_SAVED_CONVERSATIONS
        ),
        activeId:
          conversation.id
      })
    );

    setText("");
    setError("");

    removeFile();

    setVoiceStatus("");
    setLoading(false);
    setLoadingConversationId(
      null
    );
  }

  function openConversation(
    conversation
  ) {
    stopSpeaking();

    try {
      recognitionRef.current?.stop();
    } catch (_) {}

    const conversationGrade =
      conversation.grade ||
      "Terminale";

    const conversationSerie =
      normalizeSerie(
        conversationGrade,
        conversation.serie
      );

    setSavedData(
      previous => ({
        ...previous,
        activeId:
          conversation.id
      })
    );

    setGrade(
      conversationGrade
    );

    setSerie(
      conversationSerie
    );

    setSubject(
      conversation.subject ||
        "Mathématiques"
    );

    setDifficulty(
      conversation.difficulty ||
        "détaillé"
    );

    setMode(
      conversation.mode ||
        "explication"
    );

    setText("");
    setError("");

    removeFile();

    setVoiceStatus("");
  }

  function deleteConversation(
    id
  ) {
    const remaining =
      conversations.filter(
        c => c.id !== id
      );

    if (
      remaining.length === 0
    ) {
      const fresh =
        makeConversation({
          grade,
          serie,
          subject,
          difficulty,
          mode
        });

      setSavedData({
        conversations: [
          fresh
        ],
        activeId:
          fresh.id
      });

      setText("");
      setError("");
      removeFile();

      return;
    }

    const nextActiveId =
      savedData.activeId ===
      id
        ? remaining[0].id
        : savedData.activeId;

    setSavedData({
      conversations:
        remaining,
      activeId:
        nextActiveId
    });

    if (
      savedData.activeId ===
      id
    ) {
      const next =
        remaining.find(
          c =>
            c.id ===
            nextActiveId
        );

      if (next) {
        openConversation(
          next
        );
      }
    }
  }

  function handleGradeChange(
    newGrade
  ) {
    setGrade(newGrade);

    if (
      !gradeHasSeries(
        newGrade
      )
    ) {
      setSerie(
        "Non précisée"
      );

      return;
    }

    setSerie(
      currentSerie =>
        SERIES.includes(
          currentSerie
        )
          ? currentSerie
          : "Non précisée"
    );
  }

  /*
   * ============================================================
   * ENVOI PRINCIPAL
   * ============================================================
   */

  async function submitQuestion(
    event
  ) {
    event?.preventDefault();

    setError("");
    setVoiceStatus("");

    stopSpeaking();

    if (
      !text.trim() &&
      !image &&
      !document &&
      !documentText.trim()
    ) {
      setError(
        "Écris une question ou ajoute un fichier."
      );

      return;
    }

    const conversationId =
      activeConversation.id;

    const currentMessages =
      activeConversation.messages ||
      [];

    const currentQuiz =
      activeConversation.quizState ||
      null;

    const effectiveSerie =
      normalizeSerie(
        grade,
        serie
      );

    const userText =
      text.trim();

    const startingNewQuiz =
      isQuizStartRequest(
        userText
      );

    const answeringQuiz =
      Boolean(
        currentQuiz?.active
      ) &&
      !startingNewQuiz;

    const stoppingQuiz =
      Boolean(
        currentQuiz?.active
      ) &&
      isQuizStopRequest(
        userText
      );

    if (stoppingQuiz) {
      const userMessage = {
        role: "user",
        content:
          userText,
        id: makeId(),
        createdAt:
          new Date().toISOString()
      };

      updateConversation(
        conversationId,
        c => ({
          ...c,
          updatedAt:
            new Date().toISOString(),
          quizState: null,
          messages: [
            ...c.messages,
            userMessage
          ]
        })
      );

      setText("");
      removeFile();

      return;
    }

    const fullText = [
      userText,

      documentText.trim()
        ? `CONTENU DU FICHIER ${fileName} :\n${documentText.trim()}`
        : ""
    ]
      .filter(Boolean)
      .join("\n\n");

    const visibleQuestion = [
      userText,

      fileName
        ? `📎 Fichier joint : ${fileName}`
        : "",

      documentText.trim()
        ? "(Contenu du fichier texte transmis à Klasévia)"
        : ""
    ]
      .filter(Boolean)
      .join("\n\n") ||
      "Analyse le fichier joint.";

    const userMessage = {
      role: "user",
      content:
        visibleQuestion,
      id: makeId(),
      createdAt:
        new Date().toISOString()
    };

    const history =
      currentMessages
        .filter(
          m =>
            m.role === "user" ||
            m.role ===
              "assistant"
        )
        .map(m => ({
          role: m.role,
          content: m.content
        }));

    const title =
      activeConversation.title ===
      "Nouvelle conversation"
        ? (
            userText ||
            fileName ||
            "Nouvelle conversation"
          ).slice(0, 55)
        : activeConversation.title;

    updateConversation(
      conversationId,
      c => ({
        ...c,
        title,
        grade,
        serie:
          effectiveSerie,
        subject,
        difficulty,
        mode,
        updatedAt:
          new Date().toISOString(),
        messages: [
          ...c.messages,
          userMessage
        ]
      })
    );

    setText("");
    removeFile();

    setLoading(true);

    setLoadingConversationId(
      conversationId
    );

    try {
      /*
       * ========================================================
       * MODE QUIZ
       * ========================================================
       */

      if (
        startingNewQuiz ||
        answeringQuiz
      ) {
        const quizAction =
          startingNewQuiz
            ? "start"
            : "answer";

        const quizStateToSend =
          startingNewQuiz
            ? null
            : currentQuiz;

        const response =
          await fetch(
            "/api/quiz",
            {
              method: "POST",
              headers: {
                "Content-Type":
                  "application/json"
              },
              body: JSON.stringify(
                {
                  action:
                    quizAction,

                  message:
                    userText,

                  grade,

                  serie:
                    effectiveSerie,

                  subject,

                  difficulty,

                  quizState:
                    quizStateToSend
                }
              )
            }
          );

        const data =
          await response.json();

        if (!response.ok) {
          throw new Error(
            data?.error ||
              "Le service de quiz est temporairement indisponible."
          );
        }

        if (!data?.answer) {
          throw new Error(
            "Aucune réponse n'a été reçue du quiz."
          );
        }

        const assistantMessage =
          {
            role: "assistant",
            content:
              data.answer,
            id: makeId(),
            createdAt:
              new Date().toISOString()
          };

        updateConversation(
          conversationId,
          c => ({
            ...c,

            updatedAt:
              new Date().toISOString(),

            quizState:
              data.quizState ||
              null,

            messages: [
              ...c.messages,
              assistantMessage
            ]
          })
        );

        return;
      }

      /*
       * ========================================================
       * MODE TUTEUR NORMAL
       * ========================================================
       */

      const response =
        await fetch(
          "/api/tutor",
          {
            method: "POST",
            headers: {
              "Content-Type":
                "application/json"
            },
            body: JSON.stringify(
              {
                mode,
                grade,
                serie:
                  effectiveSerie,
                subject,
                difficulty,
                text:
                  fullText ||
                  "Analyse le fichier joint et explique son contenu.",
                image,
                document,
                history
              }
            )
          }
        );

      const data =
        await response.json();

      if (!response.ok) {
        throw new Error(
          data?.error ||
            "Le service IA est temporairement indisponible."
        );
      }

      if (!data?.answer) {
        throw new Error(
          "Aucune réponse n'a été reçue."
        );
      }

      const assistantMessage =
        {
          role: "assistant",
          content:
            data.answer,
          id: makeId(),
          createdAt:
            new Date().toISOString()
        };

      updateConversation(
        conversationId,
        c => ({
          ...c,

          updatedAt:
            new Date().toISOString(),

          messages: [
            ...c.messages,
            assistantMessage
          ]
        })
      );
    } catch (err) {
      setError(
        err?.message ||
          "Impossible de contacter Klasévia. Vérifie ta connexion Internet."
      );
    } finally {
      setLoading(false);

      setLoadingConversationId(
        null
      );
    }
  }

  function clearDraft() {
    stopSpeaking();

    setText("");
    setError("");

    removeFile();

    setVoiceStatus("");
  }

  /*
   * ============================================================
   * ZONE DE SAISIE
   * ============================================================
   *
   * Cette zone est maintenant placée SOUS la conversation.
   *
   * Avec position: sticky, elle reste visible en bas
   * de l'écran pendant que l'utilisateur descend dans
   * la conversation.
   */

  const questionComposer = (
    <section className="k-card k-composer">
      {activeQuiz?.active && (
        <div
          className="k-quiz-status"
          aria-live="polite"
        >
          🎯{" "}
          <strong>
            Quiz en cours
          </strong>

          <br />

          Question{" "}
          <strong>
            {activeQuiz.questionNumber || 1}
          </strong>
          /
          <strong>
            {activeQuiz.total || 10}
          </strong>

          {" · "}

          Score :{" "}
          <strong>
            {activeQuiz.score || 0}
          </strong>
          /
          {Math.max(
            0,
            (activeQuiz.questionNumber || 1) - 1
          )}

          <br />

          <span>
            Ta réponse ci-dessous sera
            automatiquement envoyée au quiz.
          </span>
        </div>
      )}

      <form
        onSubmit={
          submitQuestion
        }
      >
        <div
          className="k-field"
          style={{
            marginTop:
              activeQuiz?.active
                ? 12
                : 0
          }}
        >
          <label htmlFor="k-question">
            {activeQuiz?.active
              ? "✍️ Ta réponse au quiz"
              : "🙋 Ta question ou ton cours"}
          </label>

          <textarea
            id="k-question"
            value={text}
            onChange={e =>
              setText(
                e.target.value
              )
            }
            placeholder={
              activeQuiz?.active
                ? "Écris ta réponse : 3/5, 13/15, A, B, C, D, etc."
                : "Pose une question ou continue la discussion précédente…"
            }
          />
        </div>

        <div className="k-actions">
          <button
            type="button"
            className="k-btn secondary"
            onClick={
              toggleListening
            }
            disabled={loading}
          >
            {listening
              ? "⏹ Arrêter le micro"
              : "🎙 Question vocale"}
          </button>

          <button
            type="button"
            className="k-btn secondary"
            onClick={() =>
              fileInputRef.current?.click()
            }
            disabled={
              loading ||
              activeQuiz?.active
            }
          >
            📎 Ajouter un fichier
            ou une photo
          </button>

          <input
            ref={
              fileInputRef
            }
            type="file"
            accept=".pdf,.txt,application/pdf,text/plain,image/jpeg,image/png,image/webp"
            style={{
              display: "none"
            }}
            onChange={e => {
              handleFile(
                e.target.files?.[0]
              );

              e.target.value =
                "";
            }}
          />
        </div>

        {fileName && (
          <div className="k-status">
            📄 Fichier sélectionné :{" "}
            <strong>
              {fileName}
            </strong>

            <div className="k-actions">
              <button
                type="button"
                className="k-btn secondary"
                onClick={
                  removeFile
                }
              >
                Retirer le fichier
              </button>
            </div>
          </div>
        )}

        {imagePreview && (
          <img
            src={
              imagePreview
            }
            alt="Aperçu du fichier image"
            className="k-preview"
          />
        )}

        <p className="k-note">
          Formats acceptés :
          PDF (3 Mo maximum),
          TXT (100 Ko maximum),
          images JPG, PNG ou
          WebP (4 Mo maximum).
        </p>

        <div className="k-actions">
          <button
            className="k-btn"
            type="submit"
            disabled={loading}
          >
            {loading
              ? "Klasévia réfléchit…"
              : activeQuiz?.active
                ? "✅ Valider ma réponse"
                : "✨ Envoyer ma question"}
          </button>

          {activeQuiz?.active && (
            <button
              className="k-btn stop"
              type="button"
              onClick={() => {
                setText(
                  "Arrête le quiz"
                );
              }}
              disabled={loading}
            >
              🛑 Terminer le quiz
            </button>
          )}

          <button
            className="k-btn secondary"
            type="button"
            onClick={
              clearDraft
            }
            disabled={loading}
          >
            Effacer le brouillon
          </button>
        </div>
      </form>

      {error && (
        <div
          className="k-error"
          role="alert"
        >
          {error}
        </div>
      )}

      {voiceStatus && (
        <div
          className="k-status"
          aria-live="polite"
        >
          {voiceStatus}
        </div>
      )}
    </section>
  );

  return (
    <main className="klasevia-app">
      <style>{`
        .klasevia-app{
          max-width:1000px;
          margin:0 auto;
          padding:18px;
          color:#18352d;
          font-family:system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;
        }

        .k-hero{
          background:linear-gradient(135deg,#e8f6ee,#f5fbf7);
          border:1px solid #d6e8dd;
          border-radius:22px;
          padding:24px;
          margin-bottom:18px;
        }

        .k-hero h1{
          margin:0 0 8px;
          font-size:30px;
        }

        .k-hero p{
          margin:0;
          line-height:1.6;
        }

        .k-layout{
          display:grid;
          grid-template-columns:minmax(220px,270px) minmax(0,1fr);
          gap:16px;
          align-items:start;
        }

        .k-card{
          background:#fff;
          border:1px solid #dce6df;
          border-radius:18px;
          padding:20px;
          margin:0 0 16px;
          box-shadow:0 4px 18px #19382b0a;
          min-width:0;
        }

        /*
         * NOUVEAU :
         * la zone de saisie reste visible
         * en bas pendant le défilement.
         */
        .k-composer{
          position:sticky;
          bottom:10px;
          z-index:20;
          box-shadow:0 8px 30px rgba(24,53,45,.14);
          border-color:#cbded2;
        }

        .k-grid{
          display:grid;
          grid-template-columns:repeat(2,minmax(0,1fr));
          gap:12px;
        }

        .k-field{
          display:flex;
          flex-direction:column;
          gap:6px;
        }

        .k-field label{
          font-size:14px;
          font-weight:650;
        }

        .k-field select,
        .k-field textarea,
        .k-field input{
          width:100%;
          box-sizing:border-box;
          border:1px solid #cbd9d0;
          border-radius:11px;
          padding:12px;
          font:inherit;
          background:white;
          color:#18352d;
        }

        .k-field textarea{
          min-height:120px;
          resize:vertical;
        }

        .k-composer .k-field textarea{
          min-height:95px;
          max-height:220px;
        }

        .k-actions{
          display:flex;
          flex-wrap:wrap;
          gap:10px;
          margin-top:14px;
        }

        .k-btn{
          border:0;
          border-radius:12px;
          padding:12px 16px;
          background:#176c4c;
          color:white;
          font:inherit;
          font-weight:650;
          cursor:pointer;
        }

        .k-btn.secondary{
          background:#eaf4ed;
          color:#19583f;
        }

        .k-btn.stop{
          background:#8b3333;
        }

        .k-btn:disabled{
          opacity:.55;
          cursor:not-allowed;
        }

        .k-note{
          color:#526a5e;
          font-size:13px;
          line-height:1.5;
        }

        .k-error{
          background:#fff0ee;
          color:#8b2525;
          padding:12px;
          border-radius:10px;
          margin-top:12px;
          overflow-wrap:anywhere;
        }

        .k-status{
          background:#edf7f0;
          color:#245f43;
          padding:10px;
          border-radius:10px;
          margin-top:12px;
          font-size:14px;
          overflow-wrap:anywhere;
        }

        .k-quiz-status{
          background:#fff8df;
          border:1px solid #eadb98;
          color:#665117;
          padding:12px;
          border-radius:12px;
          font-size:14px;
          line-height:1.5;
        }

        .k-answer{
          line-height:1.75;
          overflow-wrap:anywhere;
        }

        .k-answer img{
          max-width:100%;
        }

        .k-answer table{
          display:block;
          max-width:100%;
          overflow-x:auto;
        }

        .k-answer pre{
          overflow-x:auto;
          padding:12px;
          background:#f4f7f5;
          border-radius:10px;
        }

        .k-preview{
          max-width:100%;
          max-height:260px;
          border-radius:12px;
          margin-top:12px;
        }

        .k-answer .katex-display{
          overflow-x:auto;
          overflow-y:hidden;
          padding:5px 0;
        }

        .k-history-title{
          display:flex;
          align-items:center;
          justify-content:space-between;
          gap:8px;
        }

        .k-history-title h2{
          font-size:19px;
          margin:0;
        }

        .k-history-list{
          display:flex;
          flex-direction:column;
          gap:8px;
          margin-top:14px;
        }

        .k-history-item{
          display:flex;
          align-items:stretch;
          gap:4px;
          border:1px solid #dce6df;
          border-radius:12px;
          overflow:hidden;
        }

        .k-history-open{
          flex:1;
          min-width:0;
          text-align:left;
          background:white;
          color:#18352d;
          border:0;
          padding:11px;
          cursor:pointer;
          font:inherit;
        }

        .k-history-open.active{
          background:#e8f6ee;
        }

        .k-history-name{
          display:block;
          font-size:14px;
          font-weight:700;
          overflow-wrap:anywhere;
        }

        .k-history-date{
          display:block;
          font-size:12px;
          color:#607368;
          margin-top:4px;
        }

        .k-delete{
          border:0;
          background:#fff0ee;
          color:#8b2525;
          padding:8px;
          cursor:pointer;
        }

        .k-message{
          padding:14px;
          border-radius:14px;
          margin:14px 0;
          min-width:0;
        }

        .k-message.user{
          background:#edf6f0;
          border:1px solid #d8e9dd;
        }

        .k-message.assistant{
          background:#fff;
          border:1px solid #e0e7e2;
        }

        .k-message-label{
          font-size:12px;
          font-weight:750;
          color:#426553;
          margin-bottom:7px;
        }

        .k-message-content{
          line-height:1.7;
          overflow-wrap:anywhere;
        }

        .k-message-content pre{
          white-space:pre-wrap;
          overflow-wrap:anywhere;
        }

        .k-message-content .katex-display{
          overflow-x:auto;
          overflow-y:hidden;
        }

        /*
         * Nouveau :
         * les boutons d'action des réponses
         * sont regroupés proprement.
         */
        .k-response-actions{
          display:flex;
          flex-wrap:wrap;
          gap:8px;
          margin-top:12px;
        }

        .k-copy-success{
          background:#dff4e5 !important;
          color:#175c3c !important;
        }

        .k-empty{
          padding:20px 10px;
          text-align:center;
          color:#607368;
          line-height:1.6;
        }

        .k-sidebar-new{
          width:100%;
          margin-top:12px;
        }

        @media(max-width:720px){
          .klasevia-app{
            padding:10px;
          }

          .k-layout{
            grid-template-columns:1fr;
          }

          .k-hero{
            padding:19px;
          }

          .k-hero h1{
            font-size:25px;
          }

          .k-card{
            padding:15px;
          }

          .k-grid{
            grid-template-columns:1fr;
          }

          /*
           * Sur téléphone, on garde une petite marge
           * en bas pour que la zone de saisie ne colle
           * pas complètement au bord.
           */
          .k-composer{
            bottom:6px;
            padding:13px;
          }

          .k-actions .k-btn{
            flex:1 1 100%;
          }

          .k-composer .k-actions .k-btn{
            flex:1 1 100%;
          }
        }
      `}</style>

      <header className="k-hero">
        <h1>📚 Klasévia</h1>

        <p>
          Ton compagnon
          d’apprentissage :
          pose tes questions,
          partage tes documents
          et progresse à ton
          rythme.
        </p>
      </header>

      <div className="k-layout">
        <aside className="k-card">
          <div className="k-history-title">
            <h2>
              🗂️ Mes conversations
            </h2>
          </div>

          <button
            type="button"
            className="k-btn k-sidebar-new"
            onClick={
              createNewConversation
            }
            disabled={loading}
          >
            ＋ Nouvelle
            conversation
          </button>

          <p className="k-note">
            Tes discussions sont
            sauvegardées dans ce
            navigateur.
          </p>

          <div className="k-history-list">
            {[...conversations]
              .sort(
                (a, b) =>
                  new Date(
                    b.updatedAt
                  ) -
                  new Date(
                    a.updatedAt
                  )
              )
              .map(
                conversation => (
                  <div
                    className="k-history-item"
                    key={
                      conversation.id
                    }
                  >
                    <button
                      type="button"
                      className={`k-history-open ${
                        conversation.id ===
                        savedData.activeId
                          ? "active"
                          : ""
                      }`}
                      onClick={() =>
                        openConversation(
                          conversation
                        )
                      }
                      disabled={
                        loading
                      }
                    >
                      <span className="k-history-name">
                        {
                          conversation.title
                        }
                      </span>

                      <span className="k-history-date">
                        {formatDate(
                          conversation.updatedAt
                        )}
                      </span>

                      <span className="k-history-date">
                        {
                          conversation
                            .messages
                            .length
                        }{" "}
                        message(s)
                      </span>

                      {conversation.quizState?.active && (
                        <span className="k-history-date">
                          🎯 Quiz en cours
                        </span>
                      )}
                    </button>

                    <button
                      type="button"
                      className="k-delete"
                      title="Supprimer cette conversation"
                      aria-label={`Supprimer ${conversation.title}`}
                      onClick={() => {
                        if (
                          window.confirm(
                            "Supprimer définitivement cette conversation ?"
                          )
                        ) {
                          deleteConversation(
                            conversation.id
                          );
                        }
                      }}
                      disabled={
                        loading
                      }
                    >
                      🗑️
                    </button>
                  </div>
                )
              )}
          </div>
        </aside>

        <div>
          {/*
           * ======================================================
           * PARAMÈTRES
           * ======================================================
           *
           * La zone de saisie n'est plus ici.
           * Elle est maintenant sous la conversation.
           */}

          <section className="k-card">
            <h2>
              Préparons ta réponse
            </h2>

            <div className="k-grid">
              <div className="k-field">
                <label htmlFor="k-grade">
                  Classe
                </label>

                <select
                  id="k-grade"
                  value={grade}
                  onChange={e =>
                    handleGradeChange(
                      e.target.value
                    )
                  }
                >
                  {CLASSES.map(
                    item => (
                      <option
                        key={item}
                      >
                        {item}
                      </option>
                    )
                  )}
                </select>
              </div>

              {gradeHasSeries(
                grade
              ) && (
                <div className="k-field">
                  <label htmlFor="k-serie">
                    Série
                  </label>

                  <select
                    id="k-serie"
                    value={serie}
                    onChange={e =>
                      setSerie(
                        e.target.value
                      )
                    }
                  >
                    {SERIES.map(
                      item => (
                        <option
                          key={item}
                        >
                          {item}
                        </option>
                      )
                    )}
                  </select>
                </div>
              )}

              <div className="k-field">
                <label htmlFor="k-subject">
                  Matière
                </label>

                <select
                  id="k-subject"
                  value={subject}
                  onChange={e =>
                    setSubject(
                      e.target.value
                    )
                  }
                >
                  {SUBJECTS.map(
                    item => (
                      <option
                        key={item}
                      >
                        {item}
                      </option>
                    )
                  )}
                </select>
              </div>

              <div className="k-field">
                <label htmlFor="k-mode">
                  Type d'aide
                </label>

                <select
                  id="k-mode"
                  value={mode}
                  onChange={e =>
                    setMode(
                      e.target.value
                    )
                  }
                >
                  <option value="explication">
                    M'expliquer et
                    m'accompagner
                  </option>

                  <option value="synthese">
                    Synthétiser un cours
                  </option>
                </select>
              </div>

              <div className="k-field">
                <label htmlFor="k-detail">
                  Niveau de détail
                </label>

                <select
                  id="k-detail"
                  value={difficulty}
                  onChange={e =>
                    setDifficulty(
                      e.target.value
                    )
                  }
                >
                  <option value="simple">
                    Simple et accessible
                  </option>

                  <option value="normal">
                    Normal
                  </option>

                  <option value="détaillé">
                    Détaillé, étape par
                    étape
                  </option>
                </select>
              </div>
            </div>
          </section>

          {/*
           * ======================================================
           * CONVERSATION
           * ======================================================
           */}

          <section className="k-card">
            <h2>
              💬 Conversation
            </h2>

            {messages.length ===
              0 &&
              !loading && (
                <div className="k-empty">
                  <p>
                    Cette
                    conversation est
                    encore vide.
                  </p>

                  <p>
                    Pose ta première
                    question pour
                    commencer.
                  </p>
                </div>
              )}

            {messages.map(
              message => (
                <article
                  key={message.id}
                  className={`k-message ${
                    message.role ===
                    "user"
                      ? "user"
                      : "assistant"
                  }`}
                >
                  <div className="k-message-label">
                    {message.role ===
                    "user"
                      ? "🙋 Ta question"
                      : "📚 Klasévia"}
                  </div>

                  <div className="k-message-content">
                    {message.role ===
                    "assistant" ? (
                      <ReactMarkdown
                        remarkPlugins={[
                          remarkMath
                        ]}
                        rehypePlugins={[
                          [
                            rehypeKatex,
                            {
                              output:
                                "html"
                            }
                          ]
                        ]}
                      >
                        {
                          message.content
                        }
                      </ReactMarkdown>
                    ) : (
                      <p
                        style={{
                          whiteSpace:
                            "pre-wrap",
                          margin: 0
                        }}
                      >
                        {
                          message.content
                        }
                      </p>
                    )}
                  </div>

                  {message.role ===
                    "assistant" && (
                    <div className="k-response-actions">
                      <button
                        type="button"
                        className={`k-btn secondary ${
                          copiedMessageId ===
                          message.id
                            ? "k-copy-success"
                            : ""
                        }`}
                        onClick={() =>
                          copyResponse(
                            message.id,
                            message.content
                          )
                        }
                      >
                        {copiedMessageId ===
                        message.id
                          ? "✅ Copié !"
                          : "📋 Copier"}
                      </button>

                      <button
                        type="button"
                        className="k-btn secondary"
                        onClick={() =>
                          startSpeaking(
                            message.content
                          )
                        }
                        disabled={
                          !voiceSupported
                        }
                      >
                        🔊 Lire cette
                        réponse
                      </button>
                    </div>
                  )}
                </article>
              )
            )}

            {loading && (
              <div
                className="k-status"
                aria-live="polite"
              >
                {activeQuiz?.active
                  ? "Klasévia corrige ta réponse et prépare la suite du quiz…"
                  : "Klasévia prépare ta réponse. Patiente un instant…"}
              </div>
            )}

            {answer && (
              <div className="k-actions">
                {!speaking ? (
                  <button
                    type="button"
                    className="k-btn"
                    onClick={() =>
                      startSpeaking(
                        answer
                      )
                    }
                    disabled={
                      !voiceSupported
                    }
                  >
                    🔊 Écouter la
                    dernière réponse
                    à {SPEED}×
                  </button>
                ) : (
                  <button
                    type="button"
                    className="k-btn stop"
                    onClick={
                      stopSpeaking
                    }
                  >
                    ⏹ Arrêter la
                    lecture
                  </button>
                )}
              </div>
            )}

            {availableVoice && (
              <p className="k-note">
                Voix détectée :{" "}
                {availableVoice}
              </p>
            )}

            {!voiceSupported && (
              <p className="k-note">
                Pour écouter les
                réponses, essaie
                Chrome sur Android.
              </p>
            )}

            {!recognitionSupported && (
              <p className="k-note">
                Tu peux dicter ta
                question avec le
                microphone du clavier
                Android.
              </p>
            )}
          </section>

          {/*
           * ======================================================
           * NOUVELLE ZONE DE SAISIE
           * ======================================================
           *
           * Elle est maintenant directement après la conversation.
           * position: sticky la maintient visible en bas de l'écran.
           */}

          {questionComposer}
        </div>
      </div>

      <footer
        className="k-note"
        style={{
          textAlign: "center",
          padding: 12
        }}
      >
        Klasévia · Apprendre,
        comprendre et progresser.
      </footer>
    </main>
  );
}

createRoot(
  document.getElementById("root")
).render(
  <App />
);