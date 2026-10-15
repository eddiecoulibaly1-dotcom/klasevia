
import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import ReactMarkdown from "react-markdown";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import "katex/dist/katex.min.css";
import "./style.css";

const CLASSES = [
  "CP1", "CP2", "CE1", "CE2", "CM1", "CM2",
  "6e", "5e", "4e", "3e",
  "Seconde", "Première", "Terminale"
];

const SUBJECTS = [
  "Mathématiques", "Français", "Anglais",
  "Physique-Chimie", "SVT", "Histoire-Géographie",
  "Philosophie", "Informatique", "Économie",
  "Éducation civique", "Autre"
];

const SERIES = [
  "Non précisée", "Tronc commun", "A1", "A2",
  "C", "D", "A", "F", "G", "Autre"
];

const SPEED = 1.25;

function getSpeechRecognition() {
  if (typeof window === "undefined") return null;
  return window.SpeechRecognition ||
    window.webkitSpeechRecognition ||
    null;
}

function chooseFrenchVoice(voices) {
  const frenchVoices = voices.filter((voice) =>
    /^fr([-_]|$)/i.test(voice.lang || "")
  );

  if (!frenchVoices.length) return null;

  // Favoriser une voix française naturelle si le téléphone en propose une.
  const preferred = frenchVoices.find((voice) =>
    /natural|naturel|neural|premium|enhanced/i.test(voice.name)
  );

  if (preferred) return preferred;

  return frenchVoices.find((voice) =>
    /^fr-FR$/i.test(voice.lang)
  ) || frenchVoices[0];
}

function splitSpeech(text, maxLength = 220) {
  const cleaned = text
    .replace(/```[\s\S]*?```/g, " bloc de code omis ")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/(\$|\\\[|\\\])/g, " ")
    .replace(/[*_#`>|]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!cleaned) return [];

  const sentences = cleaned.match(/[^.!?]+[.!?]+|[^.!?]+$/g) || [cleaned];
  const chunks = [];
  let current = "";

  for (const sentence of sentences) {
    const part = sentence.trim();
    if (!part) continue;

    if ((current + " " + part).trim().length <= maxLength) {
      current = (current + " " + part).trim();
    } else {
      if (current) chunks.push(current);

      if (part.length <= maxLength) {
        current = part;
      } else {
        const words = part.split(/\s+/);
        current = "";

        for (const word of words) {
          if ((current + " " + word).trim().length > maxLength) {
            if (current) chunks.push(current);
            current = word;
          } else {
            current = (current + " " + word).trim();
          }
        }
      }
    }
  }

  if (current) chunks.push(current);
  return chunks;
}

function App() {
  const [grade, setGrade] = useState("Terminale");
  const [serie, setSerie] = useState("D");
  const [subject, setSubject] = useState("Mathématiques");
  const [difficulty, setDifficulty] = useState("détaillé");
  const [mode, setMode] = useState("explication");
  const [text, setText] = useState("");
  const [image, setImage] = useState(null);
  const [imagePreview, setImagePreview] = useState("");
  const [answer, setAnswer] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [speaking, setSpeaking] = useState(false);
  const [listening, setListening] = useState(false);
  const [voiceStatus, setVoiceStatus] = useState("");
  const [availableVoice, setAvailableVoice] = useState("");
  const [voiceSupported, setVoiceSupported] = useState(false);
  const [recognitionSupported, setRecognitionSupported] = useState(false);

  const fileInputRef = useRef(null);
  const recognitionRef = useRef(null);
  const speechRunRef = useRef(0);
  const speechQueueRef = useRef([]);
  const speechIndexRef = useRef(0);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;

    const synth = window.speechSynthesis;
    const Recognition = getSpeechRecognition();

    setVoiceSupported(Boolean(synth && window.SpeechSynthesisUtterance));
    setRecognitionSupported(Boolean(Recognition));

    function updateVoice() {
      if (!synth) return;
      const voice = chooseFrenchVoice(synth.getVoices());
      setAvailableVoice(
        voice
          ? `${voice.name} (${voice.lang})`
          : "Voix française du téléphone non détectée"
      );
    }

    if (synth) {
      updateVoice();
      synth.addEventListener?.("voiceschanged", updateVoice);
    }

    return () => {
      mountedRef.current = false;
      speechRunRef.current += 1;

      if (synth) {
        synth.cancel();
        synth.removeEventListener?.("voiceschanged", updateVoice);
      }

      try {
        recognitionRef.current?.stop();
      } catch (_) {}
    };
  }, []);

  function stopSpeaking() {
    speechRunRef.current += 1;
    speechQueueRef.current = [];
    speechIndexRef.current = 0;

    if ("speechSynthesis" in window) {
      window.speechSynthesis.cancel();
    }

    setSpeaking(false);
    setVoiceStatus("");
  }

  function speakNext(runId) {
    if (runId !== speechRunRef.current) return;

    const synth = window.speechSynthesis;
    const chunks = speechQueueRef.current;
    const index = speechIndexRef.current;

    if (index >= chunks.length) {
      setSpeaking(false);
      setVoiceStatus("");
      return;
    }

    const utterance = new SpeechSynthesisUtterance(chunks[index]);
    const voice = chooseFrenchVoice(synth.getVoices());

    utterance.lang = voice?.lang || "fr-FR";
    if (voice) utterance.voice = voice;

    utterance.rate = SPEED;
    utterance.pitch = 1.05;
    utterance.volume = 1;

    utterance.onend = () => {
      if (runId !== speechRunRef.current) return;
      speechIndexRef.current += 1;
      speakNext(runId);
    };

    utterance.onerror = (event) => {
      if (runId !== speechRunRef.current) return;
      if (event.error === "canceled" || event.error === "interrupted") {
        return;
      }

      setSpeaking(false);
      setVoiceStatus(
        "La lecture a rencontré un problème. Essaie de relancer la lecture."
      );
    };

    synth.speak(utterance);
  }

  function startSpeaking() {
    if (!answer.trim()) {
      setVoiceStatus("Aucune réponse à lire pour le moment.");
      return;
    }

    if (!("speechSynthesis" in window)) {
      setVoiceStatus(
        "La lecture vocale n'est pas disponible dans ce navigateur."
      );
      return;
    }

    stopSpeaking();

    const runId = speechRunRef.current;
    speechQueueRef.current = splitSpeech(answer);
    speechIndexRef.current = 0;

    if (!speechQueueRef.current.length) {
      setVoiceStatus("Aucun texte lisible dans cette réponse.");
      return;
    }

    setSpeaking(true);
    setVoiceStatus(`Lecture en cours à ${SPEED}×`);

    // Certains navigateurs Android conservent une ancienne file :
    // on annule d'abord la lecture précédente, puis on démarre.
    window.speechSynthesis.cancel();

    // Démarrer directement après l'action de l'utilisateur.
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

    const Recognition = getSpeechRecognition();

    if (!Recognition) {
      setVoiceStatus(
        "La saisie vocale n'est pas prise en charge par ce navigateur. Tu peux utiliser le microphone du clavier Android."
      );
      return;
    }

    stopSpeaking();

    const recognition = new Recognition();
    recognition.lang = "fr-FR";
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;
    recognitionRef.current = recognition;

    let finalTranscript = "";

    recognition.onstart = () => {
      setListening(true);
      setVoiceStatus("Je t'écoute. Parle maintenant.");
    };

    recognition.onresult = (event) => {
      let interimTranscript = "";

      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        if (result.isFinal) {
          finalTranscript += result[0].transcript + " ";
        } else {
          interimTranscript += result[0].transcript;
        }
      }

      const combined = (finalTranscript + interimTranscript).trim();
      if (combined) setText((previous) => {
        const base = previous.trim();
        return base ? `${base} ${combined}` : combined;
      });
    };

    recognition.onerror = (event) => {
      setListening(false);
      setVoiceStatus(
        event.error === "not-allowed"
          ? "Autorise le microphone dans les paramètres du navigateur."
          : "La reconnaissance vocale a échoué. Réessaie ou utilise le microphone du clavier."
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
      setVoiceStatus("Impossible de démarrer le microphone. Réessaie.");
    }
  }

  async function handleImage(file) {
    setError("");
    setImage(null);
    setImagePreview("");

    if (!file) return;

    const allowedTypes = [
      "image/jpeg",
      "image/png",
      "image/webp",
      "image/heic",
      "image/heif"
    ];

    if (!allowedTypes.includes(file.type)) {
      setError("Choisis une image JPG, PNG ou WebP compatible.");
      return;
    }

    if (file.size > 5 * 1024 * 1024) {
      setError("L'image doit peser moins de 5 Mo.");
      return;
    }

    try {
      const data = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(new Error("Lecture impossible"));
        reader.readAsDataURL(file);
      });

      const base64 = String(data).split(",")[1];

      setImage({
        data: base64,
        mimeType: file.type
      });

      setImagePreview(String(data));
    } catch (_) {
      setError("Impossible de lire cette image. Essaie une autre photo.");
    }
  }

  async function submitQuestion(event) {
    event?.preventDefault();
    setError("");
    setVoiceStatus("");
    stopSpeaking();

    if (!text.trim() && !image) {
      setError("Écris une question ou ajoute une photo d'exercice.");
      return;
    }

    setLoading(true);
    setAnswer("");

    try {
      const response = await fetch("/api/tutor", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          mode,
          grade,
          serie,
          subject,
          difficulty,
          text: text.trim(),
          image
        })
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(
          data?.error || "Le service IA est temporairement indisponible."
        );
      }

      if (!data?.answer) {
        throw new Error("Aucune réponse n'a été reçue.");
      }

      setAnswer(data.answer);
    } catch (err) {
      setError(
        err?.message ||
        "Impossible de contacter Klasévia. Vérifie ta connexion Internet."
      );
    } finally {
      setLoading(false);
    }
  }

  function clearConversation() {
    stopSpeaking();
    setText("");
    setAnswer("");
    setError("");
    setImage(null);
    setImagePreview("");
    setVoiceStatus("");

    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  }

  return (
    <main className="klasevia-app">
      <style>{`
        .klasevia-app {
          max-width: 900px;
          margin: 0 auto;
          padding: 18px;
          color: #18352d;
          font-family: system-ui, -apple-system, BlinkMacSystemFont,
            "Segoe UI", sans-serif;
        }
        .k-hero {
          background: linear-gradient(135deg,#e8f6ee,#f5fbf7);
          border: 1px solid #d6e8dd;
          border-radius: 22px;
          padding: 24px;
          margin-bottom: 18px;
        }
        .k-hero h1 { margin: 0 0 8px; font-size: 30px; }
        .k-hero p { margin: 0; line-height: 1.6; }
        .k-card {
          background: #fff;
          border: 1px solid #dce6df;
          border-radius: 18px;
          padding: 20px;
          margin: 16px 0;
          box-shadow: 0 4px 18px #19382b0a;
        }
        .k-grid {
          display: grid;
          grid-template-columns: repeat(2,minmax(0,1fr));
          gap: 12px;
        }
        .k-field { display: flex; flex-direction: column; gap: 6px; }
        .k-field label { font-size: 14px; font-weight: 650; }
        .k-field select, .k-field textarea, .k-field input {
          width: 100%;
          box-sizing: border-box;
          border: 1px solid #cbd9d0;
          border-radius: 11px;
          padding: 12px;
          font: inherit;
          background: white;
          color: #18352d;
        }
        .k-field textarea { min-height: 145px; resize: vertical; }
        .k-actions { display: flex; flex-wrap: wrap; gap: 10px; margin-top: 14px; }
        .k-btn {
          border: 0;
          border-radius: 12px;
          padding: 12px 16px;
          background: #176c4c;
          color: white;
          font: inherit;
          font-weight: 650;
          cursor: pointer;
        }
        .k-btn.secondary { background: #eaf4ed; color: #19583f; }
        .k-btn.stop { background: #8b3333; }
        .k-btn:disabled { opacity: .55; cursor: not-allowed; }
        .k-note { color: #526a5e; font-size: 13px; line-height: 1.5; }
        .k-error {
          background: #fff0ee; color: #8b2525; padding: 12px;
          border-radius: 10px; margin-top: 12px;
        }
        .k-status {
          background: #edf7f0; color: #245f43; padding: 10px;
          border-radius: 10px; margin-top: 12px; font-size: 14px;
        }
        .k-answer { line-height: 1.75; overflow-wrap: anywhere; }
        .k-answer img { max-width: 100%; }
        .k-answer table { display: block; max-width: 100%; overflow-x: auto; }
        .k-answer pre { overflow-x: auto; padding: 12px; background: #f4f7f5; border-radius: 10px; }
        .k-preview { max-width: 100%; max-height: 260px; border-radius: 12px; margin-top: 12px; }
        .k-answer .katex-display { overflow-x: auto; overflow-y: hidden; padding: 5px 0; }
        @media(max-width:600px) {
          .klasevia-app { padding: 10px; }
          .k-hero { padding: 19px; }
          .k-hero h1 { font-size: 25px; }
          .k-card { padding: 15px; }
          .k-grid { grid-template-columns: 1fr; }
          .k-actions .k-btn { flex: 1 1 100%; }
        }
      `}</style>

      <header className="k-hero">
        <h1>📚 Klasévia</h1>
        <p>
          Ton compagnon d’apprentissage : pose tes questions,
          partage une photo d’exercice et progresse à ton rythme.
        </p>
      </header>

      <section className="k-card">
        <h2>Préparons ta réponse</h2>

        <div className="k-grid">
          <div className="k-field">
            <label htmlFor="k-grade">Classe</label>
            <select
              id="k-grade"
              value={grade}
              onChange={(e) => setGrade(e.target.value)}
            >
              {CLASSES.map((item) => (
                <option key={item}>{item}</option>
              ))}
            </select>
          </div>

          <div className="k-field">
            <label htmlFor="k-serie">Série</label>
            <select
              id="k-serie"
              value={serie}
              onChange={(e) => setSerie(e.target.value)}
            >
              {SERIES.map((item) => (
                <option key={item}>{item}</option>
              ))}
            </select>
          </div>

          <div className="k-field">
            <label htmlFor="k-subject">Matière</label>
            <select
              id="k-subject"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
            >
              {SUBJECTS.map((item) => (
                <option key={item}>{item}</option>
              ))}
            </select>
          </div>

          <div className="k-field">
            <label htmlFor="k-mode">Type d'aide</label>
            <select
              id="k-mode"
              value={mode}
              onChange={(e) => setMode(e.target.value)}
            >
              <option value="explication">M'expliquer et m'accompagner</option>
              <option value="synthese">Synthétiser un cours</option>
            </select>
          </div>

          <div className="k-field">
            <label htmlFor="k-detail">Niveau de détail</label>
            <select
              id="k-detail"
              value={difficulty}
              onChange={(e) => setDifficulty(e.target.value)}
            >
              <option value="simple">Simple et accessible</option>
              <option value="normal">Normal</option>
              <option value="détaillé">Détaillé, étape par étape</option>
            </select>
          </div>
        </div>

        <form onSubmit={submitQuestion}>
          <div className="k-field" style={{ marginTop: 16 }}>
            <label htmlFor="k-question">Ta question ou ton cours</label>
            <textarea
              id="k-question"
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="Écris ta question ici. Tu peux aussi utiliser le microphone."
            />
          </div>

          <div className="k-actions">
            <button
              type="button"
              className="k-btn secondary"
              onClick={toggleListening}
              disabled={loading}
            >
              {listening ? "⏹ Arrêter le micro" : "🎙 Poser une question à la voix"}
            </button>

            <button
              type="button"
              className="k-btn secondary"
              onClick={() => fileInputRef.current?.click()}
              disabled={loading}
            >
              📷 Ajouter une photo
            </button>

            <input
              ref={fileInputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp,image/heic,image/heif"
              capture="environment"
              style={{ display: "none" }}
              onChange={(e) => {
                handleImage(e.target.files?.[0]);
                e.target.value = "";
              }}
            />
          </div>

          {imagePreview && (
            <div>
              <img
                src={imagePreview}
                alt="Aperçu de l'exercice"
                className="k-preview"
              />
              <div>
                <button
                  type="button"
                  className="k-btn secondary"
                  onClick={() => {
                    setImage(null);
                    setImagePreview("");
                    if (fileInputRef.current) {
                      fileInputRef.current.value = "";
                    }
                  }}
                >
                  Retirer la photo
                </button>
              </div>
            </div>
          )}

          <p className="k-note">
            Astuce : tu peux prendre une photo d’un exercice
            ou choisir une image dans ta galerie.
          </p>

          <div className="k-actions">
            <button className="k-btn" type="submit" disabled={loading}>
              {loading ? "Klasévia réfléchit…" : "✨ Obtenir une réponse"}
            </button>

            <button
              className="k-btn secondary"
              type="button"
              onClick={clearConversation}
              disabled={loading}
            >
              Effacer
            </button>
          </div>
        </form>

        {error && <div className="k-error" role="alert">{error}</div>}
        {voiceStatus && <div className="k-status" aria-live="polite">{voiceStatus}</div>}
      </section>

      <section className="k-card">
        <h2>💡 La réponse de Klasévia</h2>

        {!answer && !loading && (
          <p className="k-note">
            Ta réponse apparaîtra ici. Tu pourras ensuite la faire lire
            à voix haute avec le bouton « Écouter ».
          </p>
        )}

        {loading && (
          <p aria-live="polite">Préparation de ta réponse. Patiente un instant…</p>
        )}

        {answer && (
          <>
            <div className="k-actions">
              {!speaking ? (
                <button
                  type="button"
                  className="k-btn"
                  onClick={startSpeaking}
                  disabled={!voiceSupported}
                >
                  🔊 Écouter à {SPEED}×
                </button>
              ) : (
                <button
                  type="button"
                  className="k-btn stop"
                  onClick={stopSpeaking}
                >
                  ⏹ Arrêter la lecture
                </button>
              )}

              <button
                type="button"
                className="k-btn secondary"
                onClick={startSpeaking}
                disabled={!voiceSupported || speaking}
              >
                ↻ Relire la réponse
              </button>
            </div>

            <p className="k-note">
              Vitesse : {SPEED}× · Style recherché : professeur chaleureux
              et pédagogue · Langue : français.
            </p>

            <p className="k-note">
              Voix détectée : {availableVoice || "Recherche en cours…"}
            </p>

            <article className="k-answer">
              <ReactMarkdown
                remarkPlugins={[remarkMath]}
                rehypePlugins={[rehypeKatex]}
              >
                {answer}
              </ReactMarkdown>
            </article>
          </>
        )}

        {!voiceSupported && (
          <p className="k-note">
            La lecture vocale n'est pas disponible dans ce navigateur.
            Essaie avec Chrome sur Android.
          </p>
        )}

        {!recognitionSupported && (
          <p className="k-note">
            Si la saisie vocale n'est pas prise en charge, utilise le
            microphone du clavier Android pour dicter ta question.
          </p>
        )}
      </section>

      <footer className="k-note" style={{ textAlign: "center", padding: 12 }}>
        Klasévia · Apprendre, comprendre et progresser.
      </footer>
    </main>
  );
}

createRoot(document.getElementById("root")).render(<App />);
