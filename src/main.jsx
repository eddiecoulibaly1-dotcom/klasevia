
function speak() {
  if (!result.trim()) {
    setError("Aucune réponse à écouter.");
    return;
  }

  if (!("speechSynthesis" in window)) {
    setError("La lecture vocale n'est pas prise en charge par ce navigateur.");
    return;
  }

  const synth = window.speechSynthesis;
  synth.cancel();

  const spokenText = makeSpeakable(result);

  if (!spokenText) {
    setError("Aucun texte lisible n'a été trouvé.");
    return;
  }

  // Découper la réponse en phrases courtes pour Android.
  const sentences = spokenText.match(/[^.!?;]+[.!?;]*/g) || [spokenText];
  const chunks = [];
  let current = "";

  for (const sentence of sentences) {
    const part = sentence.trim();
    if (!part) continue;

    if ((current + " " + part).trim().length > 180 && current) {
      chunks.push(current.trim());
      current = part;
    } else {
      current = (current + " " + part).trim();
    }
  }

  if (current) chunks.push(current.trim());

  const voices = synth.getVoices();
  const frenchVoice = voices.find(
    (v) => v.lang && v.lang.toLowerCase().startsWith("fr")
  );

  let index = 0;
  let failed = false;

  setError("");
  setSpeaking(true);

  function speakNext() {
    if (index >= chunks.length) {
      setSpeaking(false);
      return;
    }

    const utterance = new SpeechSynthesisUtterance(chunks[index]);
    utterance.lang = "fr-FR";
    utterance.rate = 0.88;
    utterance.volume = 1;

    if (frenchVoice) utterance.voice = frenchVoice;

    utterance.onend = () => {
      index += 1;
      speakNext();
    };

    utterance.onerror = (event) => {
      if (event.error === "canceled" || event.error === "interrupted") {
        setSpeaking(false);
        return;
      }

      failed = true;
      setSpeaking(false);
      setError(
        "La lecture a échoué. Réessaie en rechargeant la page."
      );
    };

    try {
      synth.speak(utterance);
    } catch (e) {
      failed = true;
      setSpeaking(false);
      setError("Impossible de démarrer la lecture vocale.");
    }
  }

  synth.resume();
  speakNext();
}
