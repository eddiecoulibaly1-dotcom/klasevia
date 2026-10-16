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
    // Historique illisible.
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
      /![^]*\][^)]*/g,
      ""
    )
    .replace(
      /([^]+)\][^)]*/g,
      "$1"
    )
    .replace(
      /(\$|\\|\\)/g,
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
         