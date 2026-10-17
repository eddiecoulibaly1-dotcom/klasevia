import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import ReactMarkdown from "react-markdown";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import { supabase } from "./supabaseClient";
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

/*
 * ============================================================
 * IDENTIFIANT
 * ============================================================
 */

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

/*
 * ============================================================
 * CONVERSATION
 * ============================================================
 */

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

    /*
     * NOUVEAU :
     * Le thème est conservé dans chaque conversation.
     */
    theme:
      settings.theme || "",

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

    /*
     * NOUVEAU :
     * Compatibilité avec les anciennes conversations.
     */
    theme:
      typeof conversation.theme === "string"
        ? conversation.theme
        : "",

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

/*
 * ============================================================
 * VOIX
 * ============================================================
 */

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

/*
 * ============================================================
 * FICHIERS
 * ============================================================
 */

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

/*
 * ============================================================
 * APPLICATION
 * ============================================================
 */

function App() {
  const [savedData, setSavedData] =
    useState(loadSavedData);

  const [grade, setGrade] =
    useState("Terminale");

  const [serie, setSerie] =
    useState("D");

  const [subject, setSubject] =
    useState("Mathématiques");

  /*
   * NOUVEAU :
   * État du thème.
   */
  const [theme, setTheme] =
    useState("");

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

  // ==========================================================
  // COMPTE & PONT SUPABASE — V58
  // ==========================================================
  const [cloudEmail, setCloudEmail] = useState("");
  const [cloudPassword, setCloudPassword] = useState("");
  const [cloudUser, setCloudUser] = useState(null);
  const [cloudProfile, setCloudProfile] = useState(null);
  const [cloudProgress, setCloudProgress] = useState([]);
  const [cloudSkills, setCloudSkills] = useState([]);
  const [selectedSkillId, setSelectedSkillId] = useState("");
  const [cloudReviews, setCloudReviews] = useState([]);
  const [cloudConversations, setCloudConversations] = useState([]);
  const [cloudReady, setCloudReady] = useState(false);
  const [cloudLoading, setCloudLoading] = useState(true);
  const [cloudBusy, setCloudBusy] = useState(false);
  const [cloudError, setCloudError] = useState("");

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

  /*
   * ==========================================================
   * SAUVEGARDE
   * ==========================================================
   */

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

  /*
   * ==========================================================
   * PONT SUPABASE — V58
   * ==========================================================
   */

  async function loadCloudData(user) {
    if (!user) {
      setCloudProfile(null);
      setCloudProgress([]);
      setCloudReviews([]);
      return;
    }

    const [profileResult, progressResult, reviewResult, conversationsResult, skillsResult] = await Promise.all([
      supabase
        .from("profiles")
        .select("user_id, full_name, role, xp, streak_days, level")
        .eq("user_id", user.id)
        .maybeSingle(),
      supabase
        .from("skill_progress")
        .select("skill_id, mastery, attempts, correct_attempts, last_attempt_at, updated_at")
        .eq("user_id", user.id)
        .order("mastery", { ascending: false }),
      supabase
        .from("review_recommendations")
        .select("id, skill_id, exercise_id, reason, due_at, priority, status, created_at")
        .eq("student_id", user.id)
        .eq("status", "open")
        .order("due_at", { ascending: true })
        .limit(20),
      supabase
        .from("student_conversations")
        .select("id, local_id, title, grade, serie, subject, theme, difficulty, mode, quiz_state, status, created_at, updated_at, context")
        .eq("student_id", user.id)
        .eq("status", "active")
        .order("updated_at", { ascending: false })
        .limit(MAX_SAVED_CONVERSATIONS),
      supabase
        .from("skills")
        .select("id, subject_id, name, description, sort_order")
        .order("subject_id")
        .order("sort_order")
    ]);

    if (profileResult.error) throw profileResult.error;
    if (progressResult.error) throw progressResult.error;
    if (reviewResult.error) throw reviewResult.error;
    if (conversationsResult.error) throw conversationsResult.error;
    if (skillsResult.error) throw skillsResult.error;

    const remoteConversations = (conversationsResult.data || [])
      .map(row => normalizeConversation({
        id: row.local_id,
        title: row.title,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        grade: row.grade,
        serie: row.serie,
        subject: row.subject,
        theme: row.theme || "",
        difficulty: row.difficulty || "détaillé",
        mode: row.mode || "explication",
        quizState: row.quiz_state || null,
        messages: Array.isArray(row.context?.messages) ? row.context.messages : [],
        context: row.context || {}
      }))
      .filter(Boolean);

    setCloudProfile(profileResult.data || null);
    setCloudProgress(progressResult.data || []);
    setCloudReviews(reviewResult.data || []);
    setCloudSkills(skillsResult.data || []);
    setCloudConversations(remoteConversations);
    return remoteConversations;
  }

  function mergeConversationSources(previous, remoteConversations = []) {
    const localConversations = previous?.conversations || [];
    const byId = new Map();

    for (const conversation of localConversations) {
      const normalized = normalizeConversation(conversation);
      if (normalized) byId.set(normalized.id, normalized);
    }

    for (const remote of remoteConversations) {
      const local = byId.get(remote.id);
      if (!local || new Date(remote.updatedAt).getTime() > new Date(local.updatedAt).getTime()) {
        byId.set(remote.id, remote);
      }
    }

    const merged = [...byId.values()]
      .sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt))
      .slice(0, MAX_SAVED_CONVERSATIONS);

    const activeId = merged.some(c => c.id === previous?.activeId)
      ? previous.activeId
      : merged[0]?.id;

    return { conversations: merged, activeId };
  }

  function inferSkillForConversation(conversation) {
    const haystack = `${conversation?.subject || ""} ${conversation?.theme || ""} ${conversation?.messages?.slice(-2).map(m => m.content).join(" ") || ""}`.toLowerCase();
    const rules = [
      ["math.fractions", /fraction|fractions|numérateur|dénominateur|simplifier|quart|tiers|moitié/],
      ["math.equations", /équation|equations|inconnue|x\s*[+=-]|résoudre/],
      ["fr.sujet", /sujet|phrase|verbe|accord|grammaire/],
      ["svt.photosynthese", /photosynthèse|chlorophylle|lumière|co2|dioxyde de carbone/],
      ["pc.units", /unité|unités|grandeur|mètre|kilogramme|seconde|physique/],
      ["hg.reperes", /histoire|géographie|repère|dates|guerre|espace|territoire/],
      ["en.vocabulaire", /anglais|english|vocabulaire|word|words|meaning/]
    ];
    const hit = rules.find(([, regex]) => regex.test(haystack));
    return hit?.[0] || "";
  }

  async function saveConversationToCloud(conversation) {
    if (!cloudUser || !conversation) return;

    const payload = {
      student_id: cloudUser.id,
      local_id: conversation.id,
      title: conversation.title || "Nouvelle conversation",
      grade: conversation.grade || "Terminale",
      serie: conversation.serie || null,
      subject: conversation.subject || null,
      theme: conversation.theme || null,
      difficulty: conversation.difficulty || null,
      mode: conversation.mode || null,
      quiz_state: conversation.quizState || {},
      status: "active",
      context: {
        version: 2,
        source: "klasevia-react-v60",
        skill_id: conversation.context?.skill_id || inferSkillForConversation(conversation) || null,
        messages: Array.isArray(conversation.messages) ? conversation.messages : []
      },
      created_at: conversation.createdAt || new Date().toISOString(),
      updated_at: conversation.updatedAt || new Date().toISOString()
    };

    const { error: cloudSaveError } = await supabase
      .from("student_conversations")
      .upsert(payload, { onConflict: "student_id,local_id" });

    if (cloudSaveError) {
      throw cloudSaveError;
    }
  }

  async function deleteConversationFromCloud(localId) {
    if (!cloudUser || !localId) return;

    const { error: cloudDeleteError } = await supabase
      .from("student_conversations")
      .delete()
      .eq("student_id", cloudUser.id)
      .eq("local_id", localId);

    if (cloudDeleteError) throw cloudDeleteError;
  }

  useEffect(() => {
    if (!cloudReady || !cloudUser) return;

    const timer = window.setTimeout(async () => {
      try {
        for (const conversation of savedData.conversations) {
          await saveConversationToCloud(conversation);
        }
        setCloudConversations(savedData.conversations);
      } catch (syncError) {
        setCloudError(syncError?.message || "La synchronisation de l'historique a échoué.");
      }
    }, 500);

    return () => window.clearTimeout(timer);
  }, [savedData.conversations, cloudReady, cloudUser]);

  useEffect(() => {
    let mounted = true;

    async function initCloud() {
      setCloudLoading(true);
      setCloudError("");

      try {
        const { data, error: sessionError } = await supabase.auth.getSession();

        if (sessionError) {
          throw sessionError;
        }

        const sessionUser = data.session?.user || null;

        if (mounted) {
          setCloudUser(sessionUser);
          const remoteConversations = await loadCloudData(sessionUser);
          if (sessionUser) {
            setSavedData(previous => mergeConversationSources(previous, remoteConversations));
          }
          setCloudReady(Boolean(sessionUser));
        }
      } catch (cloudInitError) {
        if (mounted) {
          setCloudError(
            cloudInitError?.message ||
            "La connexion au compte Klasévia est indisponible."
          );
        }
      } finally {
        if (mounted) {
          setCloudLoading(false);
        }
      }
    }

    initCloud();

    const { data: authSubscription } =
      supabase.auth.onAuthStateChange(async (_event, session) => {
        if (!mounted) return;

        const nextUser = session?.user || null;
        setCloudUser(nextUser);
        setCloudLoading(true);
        setCloudError("");

        try {
          const remoteConversations = await loadCloudData(nextUser);
          if (nextUser) {
            setSavedData(previous => mergeConversationSources(previous, remoteConversations));
          }
          setCloudReady(Boolean(nextUser));
        } catch (cloudAuthError) {
          if (mounted) {
            setCloudError(
              cloudAuthError?.message ||
              "Impossible de charger les données Klasévia."
            );
          }
        } finally {
          if (mounted) {
            setCloudLoading(false);
          }
        }
      });

    return () => {
      mounted = false;
      authSubscription.subscription.unsubscribe();
    };
  }, []);

  async function handleCloudLogin(event) {
    event.preventDefault();

    if (!cloudEmail.trim() || !cloudPassword) {
      setCloudError("Renseigne ton email et ton mot de passe.");
      return;
    }

    setCloudBusy(true);
    setCloudError("");

    const { error: loginError } = await supabase.auth.signInWithPassword({
      email: cloudEmail.trim(),
      password: cloudPassword
    });

    setCloudBusy(false);

    if (loginError) {
      setCloudError(loginError.message);
      return;
    }

    setCloudPassword("");
  }

  async function handleCloudLogout() {
    setCloudBusy(true);
    setCloudError("");

    const { error: logoutError } = await supabase.auth.signOut();

    setCloudBusy(false);

    if (logoutError) {
      setCloudError(logoutError.message);
    }
  }

  async function refreshCloudData() {
    if (!cloudUser) return;

    setCloudLoading(true);
    setCloudError("");

    try {
      const remoteConversations = await loadCloudData(cloudUser);
      setSavedData(previous => mergeConversationSources(previous, remoteConversations));
    } catch (refreshError) {
      setCloudError(
        refreshError?.message ||
        "Impossible de rafraîchir la progression et l'historique."
      );
    } finally {
      setCloudLoading(false);
    }
  }

  const cloudMastery = cloudProgress.length
    ? Math.round(
        cloudProgress.reduce(
          (sum, item) => sum + Number(item.mastery || 0),
          0
        ) / cloudProgress.length
      )
    : 0;

  const cloudDueReviews = cloudReviews.filter(
    item => new Date(item.due_at).getTime() <= Date.now()
  ).length;

  const selectedSkill =
    cloudSkills.find(skill => skill.id === selectedSkillId) || null;

  const selectedSkillProgress =
    cloudProgress.find(item => item.skill_id === selectedSkillId) || null;

  /*
   * ==========================================================
   * INITIALISATION VOCALE
   * ==========================================================
   */

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

  /*
   * ==========================================================
   * MISE À JOUR CONVERSATION
   * ==========================================================
   */

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
   * ==========================================================
   * LECTURE VOCALE
   * ==========================================================
   */

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

  /*
   * ==========================================================
   * MICROPHONE
   * ==========================================================
   */

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

  /*
   * ==========================================================
   * FICHIERS
   * ==========================================================
   */

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

  /*
   * ==========================================================
   * NOUVELLE CONVERSATION
   * ==========================================================
   */

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

        /*
         * NOUVEAU :
         * Le thème courant est transmis
         * à la nouvelle conversation.
         */
        theme,

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
    setSelectedSkillId("");

    removeFile();

    setVoiceStatus("");
    setLoading(false);
    setLoadingConversationId(
      null
    );
  }

  /*
   * ==========================================================
   * OUVRIR UNE CONVERSATION
   * ==========================================================
   */

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

    /*
     * NOUVEAU :
     * Restaurer le thème de la conversation.
     */
    setTheme(
      conversation.theme || ""
    );

    setDifficulty(
      conversation.difficulty ||
        "détaillé"
    );

    setMode(
      conversation.mode ||
        "explication"
    );

    setSelectedSkillId(
      conversation.context?.skill_id || inferSkillForConversation(conversation) || ""
    );

    setText("");
    setError("");

    removeFile();

    setVoiceStatus("");
  }

  /*
   * ==========================================================
   * SUPPRESSION CONVERSATION
   * ==========================================================
   */

  async function deleteConversation(
    id
  ) {
    if (cloudUser) {
      try {
        await deleteConversationFromCloud(id);
      } catch (deleteError) {
        setError(deleteError?.message || "Impossible de supprimer la conversation dans le cloud.");
        return;
      }
    }

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
          theme,
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

  /*
   * ==========================================================
   * CLASSE
   * ==========================================================
   */

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
   * ==========================================================
   * ENVOI QUESTION
   * ==========================================================
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

    /*
     * ========================================================
     * NOUVEAU :
     * Le thème est ajouté au contexte envoyé au tuteur.
     *
     * Si le thème est renseigné, Klasévia sait exactement
     * quel chapitre ou sujet l'élève veut travailler.
     * ========================================================
     */

    const themeContext =
      theme.trim()
        ? `THÈME À TRAITER : ${theme.trim()}`
        : "";

    const fullText = [
      themeContext,
      userText,

      documentText.trim()
        ? `CONTENU DU FICHIER ${fileName} :\n${documentText.trim()}`
        : ""
    ]
      .filter(Boolean)
      .join("\n\n");

    const visibleQuestion = [
      theme.trim()
        ? `📌 Thème : ${theme.trim()}`
        : "",

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
            theme ||
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

        /*
         * NOUVEAU :
         * Sauvegarde du thème.
         */
        theme:
          theme.trim(),

        difficulty,
        mode,
        context: {
          ...(c.context || {}),
          version: 2,
          skill_id: selectedSkillId || inferSkillForConversation({
            ...c,
            theme,
            subject,
            messages: [...c.messages, userMessage]
          }) || null
        },
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
       * ======================================================
       * QUIZ
       * ======================================================
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

                  /*
                   * Le thème est également transmis
                   * au quiz.
                   */
                  theme:
                    theme.trim(),

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
       * ======================================================
       * TUTEUR
       * ======================================================
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

                /*
                 * NOUVEAU :
                 * Le thème est envoyé séparément à l'API.
                 */
                theme:
                  theme.trim(),

                difficulty,

                skillId: selectedSkill?.id || selectedSkillId || null,
                skillName: selectedSkill?.name || null,
                learningContext: selectedSkillProgress
                  ? {
                      mastery: Number(selectedSkillProgress.mastery || 0),
                      attempts: Number(selectedSkillProgress.attempts || 0),
                      correctAttempts: Number(selectedSkillProgress.correct_attempts || 0)
                    }
                  : null,

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

  /*
   * ==========================================================
   * EFFACER BROUILLON
   * ==========================================================
   */

  function clearDraft() {
    stopSpeaking();

    setText("");
    setError("");

    setTheme("");

    removeFile();

    setVoiceStatus("");
  }

  /*
   * ==========================================================
   * AFFICHAGE
   * ==========================================================
   */

  return (
    <main className="klasevia-app">

      <style>{`
        .klasevia-app{
          max-width:1000px;
          margin:0 auto;
          padding:18px;
          color:#18352d;
          font-family:system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif
        }

        .k-hero{
          background:linear-gradient(135deg,#e8f6ee,#f5fbf7);
          border:1px solid #d6e8dd;
          border-radius:22px;
          padding:24px;
          margin-bottom:18px
        }

        .k-hero h1{
          margin:0 0 8px;
          font-size:30px
        }

        .k-hero p{
          margin:0;
          line-height:1.6
        }

        .k-layout{
          display:grid;
          grid-template-columns:minmax(220px,270px) minmax(0,1fr);
          gap:16px;
          align-items:start
        }


        .k-learning-panel{
          background:linear-gradient(135deg,#f5fbf7,#ffffff);
          border-color:#cfe3d6
        }
        .k-learning-head{display:flex;justify-content:space-between;gap:12px;align-items:flex-start}
        .k-learning-head h2{margin:0 0 5px;font-size:19px}
        .k-learning-badge{white-space:nowrap;background:#e8f6ee;color:#176c4c;border-radius:999px;padding:7px 10px;font-size:12px;font-weight:750}
        .k-learning-summary{margin-top:10px;background:#edf7f0;border-radius:12px;padding:11px;line-height:1.55;font-size:13px}
        @media(max-width:720px){.k-learning-head{flex-direction:column}.k-learning-badge{align-self:flex-start}}

        .k-card{
          background:#fff;
          border:1px solid #dce6df;
          border-radius:18px;
          padding:20px;
          margin:0 0 16px;
          box-shadow:0 4px 18px #19382b0a;
          min-width:0
        }

        .k-grid{
          display:grid;
          grid-template-columns:repeat(2,minmax(0,1fr));
          gap:12px
        }

        .k-field{
          display:flex;
          flex-direction:column;
          gap:6px
        }

        .k-field label{
          font-size:14px;
          font-weight:650
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
          color:#18352d
        }

        .k-field textarea{
          min-height:120px;
          resize:vertical
        }

        /*
         * ======================================================
         * THÈME
         * ======================================================
         */

        .k-theme-field{
          margin-top:12px
        }

        .k-theme-field input{
          min-height:48px
        }

        .k-theme-help{
          color:#607368;
          font-size:12px;
          line-height:1.4
        }

        .k-actions{
          display:flex;
          flex-wrap:wrap;
          gap:10px;
          margin-top:14px
        }

        .k-btn{
          border:0;
          border-radius:12px;
          padding:12px 16px;
          background:#176c4c;
          color:white;
          font:inherit;
          font-weight:650;
          cursor:pointer
        }

        .k-btn.secondary{
          background:#eaf4ed;
          color:#19583f
        }

        .k-btn.stop{
          background:#8b3333
        }

        .k-btn:disabled{
          opacity:.55;
          cursor:not-allowed
        }

        .k-note{
          color:#526a5e;
          font-size:13px;
          line-height:1.5
        }

        .k-error{
          background:#fff0ee;
          color:#8b2525;
          padding:12px;
          border-radius:10px;
          margin-top:12px;
          overflow-wrap:anywhere
        }

        .k-status{
          background:#edf7f0;
          color:#245f43;
          padding:10px;
          border-radius:10px;
          margin-top:12px;
          font-size:14px;
          overflow-wrap:anywhere
        }

        .k-quiz-status{
          background:#fff8df;
          border:1px solid #eadb98;
          color:#665117;
          padding:12px;
          border-radius:12px;
          margin-top:12px;
          font-size:14px;
          line-height:1.5
        }

        .k-answer{
          line-height:1.75;
          overflow-wrap:anywhere
        }

        .k-answer img{
          max-width:100%
        }

        .k-answer table{
          display:block;
          max-width:100%;
          overflow-x:auto
        }

        .k-answer pre{
          overflow-x:auto;
          padding:12px;
          background:#f4f7f5;
          border-radius:10px
        }

        .k-preview{
          max-width:100%;
          max-height:260px;
          border-radius:12px;
          margin-top:12px
        }

        .k-answer .katex-display{
          overflow-x:auto;
          overflow-y:hidden;
          padding:5px 0
        }

        .k-history-title{
          display:flex;
          align-items:center;
          justify-content:space-between;
          gap:8px
        }

        .k-history-title h2{
          font-size:19px;
          margin:0
        }

        .k-history-list{
          display:flex;
          flex-direction:column;
          gap:8px;
          margin-top:14px
        }

        .k-history-item{
          display:flex;
          align-items:stretch;
          gap:4px;
          border:1px solid #dce6df;
          border-radius:12px;
          overflow:hidden
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
          font:inherit
        }

        .k-history-open.active{
          background:#e8f6ee
        }

        .k-history-name{
          display:block;
          font-size:14px;
          font-weight:700;
          overflow-wrap:anywhere
        }

        .k-history-date{
          display:block;
          font-size:12px;
          color:#607368;
          margin-top:4px
        }

        .k-delete{
          border:0;
          background:#fff0ee;
          color:#8b2525;
          padding:8px;
          cursor:pointer
        }

        /*
         * ======================================================
         * CONVERSATION
         * ======================================================
         */

        .k-conversation-card{
          position:relative
        }

        .k-message{
          padding:14px;
          border-radius:14px;
          margin:14px 0;
          min-width:0
        }

        .k-message.user{
          background:#edf6f0;
          border:1px solid #d8e9dd
        }

        .k-message.assistant{
          background:#fff;
          border:1px solid #e0e7e2
        }

        .k-message-label{
          font-size:12px;
          font-weight:750;
          color:#426553;
          margin-bottom:7px
        }

        .k-message-content{
          line-height:1.7;
          overflow-wrap:anywhere
        }

        .k-message-content pre{
          white-space:pre-wrap;
          overflow-wrap:anywhere
        }

        .k-message-content .katex-display{
          overflow-x:auto;
          overflow-y:hidden
        }

        .k-empty{
          padding:20px 10px;
          text-align:center;
          color:#607368;
          line-height:1.6
        }

        /*
         * ======================================================
         * COPIE
         * ======================================================
         */

        .k-copy-btn{
          display:inline-flex;
          align-items:center;
          justify-content:center;
          gap:6px;
          border:0;
          border-radius:10px;
          padding:9px 12px;
          background:#eaf4ed;
          color:#19583f;
          font:inherit;
          font-size:13px;
          font-weight:650;
          cursor:pointer
        }

        .k-copy-btn:hover{
          background:#dcefe3
        }

        .k-copy-btn:disabled{
          opacity:.6;
          cursor:not-allowed
        }

        .k-main-column{
          min-width:0
        }

        .k-cloud-card{
          margin-bottom:16px
        }

        .k-cloud-header{
          display:flex;
          align-items:center;
          justify-content:space-between;
          gap:12px;
          margin-bottom:12px
        }

        .k-cloud-header h2{
          margin:3px 0 0;
          font-size:19px
        }

        .k-cloud-eyebrow{
          color:#7a8c82;
          font-size:10px;
          font-weight:800;
          letter-spacing:1.3px
        }

        .k-cloud-badge{
          border-radius:999px;
          padding:7px 10px;
          font-size:12px;
          font-weight:750;
          white-space:nowrap
        }

        .k-cloud-badge.online{
          background:#e6f6eb;
          color:#176c4c
        }

        .k-cloud-badge.offline{
          background:#f1f3f1;
          color:#63756c
        }

        .k-cloud-grid{
          display:grid;
          grid-template-columns:1fr 1fr;
          gap:12px
        }

        .k-cloud-summary{
          display:grid;
          grid-template-columns:2fr repeat(3,1fr);
          gap:10px
        }

        .k-cloud-summary > div{
          border:1px solid #dce6df;
          border-radius:13px;
          padding:12px;
          background:#f9fcfa;
          min-width:0
        }

        .k-cloud-summary strong,
        .k-cloud-summary span{
          display:block;
          overflow-wrap:anywhere
        }

        .k-cloud-summary span{
          margin-top:4px;
          color:#687a70;
          font-size:12px
        }

        .k-cloud-skills{
          display:grid;
          grid-template-columns:repeat(2,minmax(0,1fr));
          gap:8px;
          margin-top:12px
        }

        .k-cloud-skill{
          display:flex;
          align-items:center;
          justify-content:space-between;
          gap:8px;
          padding:9px 11px;
          background:#f4f8f5;
          border-radius:10px;
          font-size:12px
        }

        .k-cloud-skill span{
          overflow-wrap:anywhere
        }

        /*
         * ======================================================
         * MOBILE
         * ======================================================
         */

        @media(max-width:720px){

          .klasevia-app{
            padding:10px
          }

          .k-layout{
            grid-template-columns:1fr
          }

          .k-hero{
            padding:19px
          }

          .k-hero h1{
            font-size:25px
          }

          .k-card{
            padding:15px
          }

          .k-grid{
            grid-template-columns:1fr
          }

          .k-cloud-grid,
          .k-cloud-summary,
          .k-cloud-skills{
            grid-template-columns:1fr
          }

          .k-cloud-header{
            align-items:flex-start
          }

          .k-main-column{
            display:flex;
            flex-direction:column;
            min-height:calc(100dvh - 20px)
          }

          .k-conversation-card{
            order:1;
            height:60dvh;
            min-height:420px;
            overflow-y:auto;
            overscroll-behavior:contain;
            margin-bottom:10px;
          }

          .k-composer-card{
            order:2;
            height:40dvh;
            min-height:300px;
            overflow-y:auto;
            overscroll-behavior:contain;
            margin-bottom:10px;
          }

          .k-composer-card .k-field textarea{
            min-height:95px;
            max-height:125px
          }

          .k-composer-card .k-actions{
            gap:8px;
            margin-top:10px
          }

          .k-composer-card .k-btn{
            padding:11px 13px
          }

          .k-actions .k-btn{
            flex:1 1 100%
          }

          .k-message{
            padding:12px;
            margin:10px 0
          }

          .k-message-content{
            font-size:16px;
            line-height:1.7
          }

          .k-theme-field{
            margin-top:10px
          }
        }

        @media(max-width:390px){

          .k-conversation-card{
            height:58dvh;
            min-height:380px
          }

          .k-composer-card{
            height:42dvh;
            min-height:290px
          }

          .k-card{
            padding:12px
          }

          .k-message-content{
            font-size:15px
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

      <section className="k-card k-cloud-card" aria-labelledby="k-cloud-title">
        <div className="k-cloud-header">
          <div>
            <span className="k-cloud-eyebrow">V59 · HISTORIQUE CLOUD</span>
            <h2 id="k-cloud-title">☁️ Compte & progression</h2>
          </div>
          <span className={`k-cloud-badge ${cloudUser ? "online" : "offline"}`}>
            {cloudLoading ? "Connexion…" : cloudUser ? "Connecté" : "Hors connexion"}
          </span>
        </div>

        {!cloudUser ? (
          <form className="k-cloud-login" onSubmit={handleCloudLogin}>
            <div className="k-cloud-grid">
              <div className="k-field">
                <label htmlFor="cloud-email">Email</label>
                <input
                  id="cloud-email"
                  type="email"
                  value={cloudEmail}
                  onChange={event => setCloudEmail(event.target.value)}
                  placeholder="eleve@exemple.com"
                  autoComplete="email"
                  disabled={cloudBusy}
                />
              </div>
              <div className="k-field">
                <label htmlFor="cloud-password">Mot de passe</label>
                <input
                  id="cloud-password"
                  type="password"
                  value={cloudPassword}
                  onChange={event => setCloudPassword(event.target.value)}
                  placeholder="••••••••"
                  autoComplete="current-password"
                  disabled={cloudBusy}
                />
              </div>
            </div>
            <div className="k-actions">
              <button className="k-btn" type="submit" disabled={cloudBusy}>
                {cloudBusy ? "Connexion…" : "🔐 Se connecter"}
              </button>
            </div>
            <p className="k-note">
              La connexion est optionnelle : l'application continue de fonctionner localement.
              Les comptes élèves doivent être créés depuis l'administration Klasévia.
            </p>
          </form>
        ) : (
          <div>
            <div className="k-cloud-summary">
              <div><strong>{cloudProfile?.full_name || cloudUser.email || "Compte Klasévia"}</strong><span>{cloudProfile?.role || "compte authentifié"}</span></div>
              <div><strong>{cloudProfile?.xp ?? 0}</strong><span>XP</span></div>
              <div><strong>{cloudMastery}%</strong><span>maîtrise moyenne</span></div>
              <div><strong>{cloudDueReviews}</strong><span>révision(s) due(s)</span></div>
              <div><strong>{cloudConversations.length}</strong><span>conversation(s) cloud</span></div>
            </div>
            <div className="k-actions">
              <button type="button" className="k-btn secondary" onClick={refreshCloudData} disabled={cloudLoading || cloudBusy}>
                ↻ Actualiser & synchroniser
              </button>
              <button type="button" className="k-btn secondary" onClick={handleCloudLogout} disabled={cloudBusy}>
                Se déconnecter
              </button>
            </div>
            {cloudProgress.length > 0 && (
              <div className="k-cloud-skills">
                {cloudProgress.slice(0, 5).map(item => (
                  <div key={item.skill_id} className="k-cloud-skill">
                    <span>{item.skill_id}</span>
                    <strong>{Number(item.mastery || 0)}%</strong>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {cloudError && (
          <div className="k-error" role="alert">
            {cloudError}
          </div>
        )}
      </section>

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
            {!cloudUser
              ? "Tes discussions sont sauvegardées dans ce navigateur. Connecte-toi pour les synchroniser automatiquement avec ton compte Klasévia."
              : "☁️ Historique synchronisé avec ton compte Klasévia."}
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

        <div className="k-main-column">

          {/* ==================================================
              ZONE DU HAUT : 3/5
              ================================================== */}

          <section
            className="k-card k-conversation-card"
          >

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
                    <div className="k-actions">

                      <button
                        type="button"
                        className="k-copy-btn"
                        onClick={async () => {
                          try {
                            await navigator.clipboard.writeText(
                              message.content
                            );

                            setVoiceStatus(
                              "✅ Réponse copiée."
                            );

                            setTimeout(
                              () =>
                                setVoiceStatus(
                                  ""
                                ),
                              1800
                            );
                          } catch (_) {
                            setVoiceStatus(
                              "Impossible de copier automatiquement cette réponse."
                            );
                          }
                        }}
                      >
                        📋 Copier la réponse
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

                      <button
                        type="button"
                        className="k-btn secondary"
                        onClick={() => setText("Vérifie ma compréhension avec une question courte sur ce que tu viens de m'expliquer.")}
                      >
                        🧠 Vérifier ma compréhension
                      </button>

                      <button
                        type="button"
                        className="k-btn secondary"
                        onClick={() => setText("Donne-moi maintenant un exercice ciblé sur cette compétence, sans donner la réponse.")}
                      >
                        ✍️ Exercice ciblé
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

          {/* ==================================================
              ZONE DU BAS : 2/5
              ================================================== */}

          <section
            className="k-card k-composer-card"
          >

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

                  <option value="guidage">
                    Apprendre avec guidage + vérification
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

            {/* ==================================================
                V61 : PARCOURS PÉDAGOGIQUE GUIDÉ
                ================================================== */}

            <section className="k-learning-panel" aria-label="Mon apprentissage">
              <div className="k-learning-panel-head">
                <div>
                  <strong>🧠 Mon apprentissage</strong>
                  <span>Une compétence suivie pour guider la prochaine étape.</span>
                </div>
                {selectedSkillProgress && (
                  <b>{Math.round(Number(selectedSkillProgress.mastery || 0))}%</b>
                )}
              </div>

              <div className="k-field">
                <label htmlFor="k-skill">Compétence suivie</label>
                <select
                  id="k-skill"
                  value={selectedSkillId}
                  onChange={e => setSelectedSkillId(e.target.value)}
                >
                  <option value="">Détection automatique</option>
                  {cloudSkills.map(skill => (
                    <option key={skill.id} value={skill.id}>
                      {skill.name} · {skill.id}
                    </option>
                  ))}
                </select>
              </div>

              {selectedSkill && (
                <div className="k-learning-stats">
                  <span>🎯 {selectedSkill.name}</span>
                  <span>📝 {selectedSkillProgress?.attempts || 0} tentative(s)</span>
                  <span>✅ {selectedSkillProgress?.correct_attempts || 0} réussite(s)</span>
                </div>
              )}
            </section>

            {/* ==================================================
                NOUVEAU : THÈME
                ================================================== */}

            <div className="k-field k-theme-field">

              <label htmlFor="k-theme">
                📌 Thème
              </label>

              <input
                id="k-theme"
                type="text"
                value={theme}
                onChange={e =>
                  setTheme(
                    e.target.value
                  )
                }
                placeholder={
                  "Ex. Fractions, équations, Première Guerre mondiale…"
                }
                maxLength={150}
              />

              <span className="k-theme-help">
                Indique le chapitre ou le sujet
                précis que tu veux travailler.
              </span>

            </div>

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
                  Ta prochaine réponse sera
                  automatiquement traitée par
                  le quiz.
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
                  marginTop: 12
                }}
              >

                <label htmlFor="k-question">
                  {activeQuiz?.active
                    ? "✍️ Ta réponse au quiz"
                    : "✍️ Ta question ou ton cours"}
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
                      ? "Écris ta réponse : 2/4, 6/10, A, B, C, D, etc."
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
                      Retirer le
                      fichier
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
                TXT (100 Ko
                maximum), images
                JPG, PNG ou WebP
                (4 Mo maximum).
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
                  Effacer le
                  brouillon
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