const BN = "০১২৩৪৫৬৭৮৯";
const bn = (n) => String(n).replace(/\d/g, (d) => BN[+d]);

const G = window.GUIDE;
const questions = G.sections.flatMap((s) => s.questions);
const STORE_KEY = "zyraxon-guide-progress";
const OPEN_KEY = "zyraxon-guide-open";

const $ = (sel) => document.querySelector(sel);
const done = new Set(JSON.parse(localStorage.getItem(STORE_KEY) || "[]"));

/* ---------- stats ---------- */
$("#stats").innerHTML = [
  [bn(questions.length), "প্রশ্ন ও উত্তর"],
  [bn(G.sections.length), "বিষয়ভিত্তিক অংশ"],
  [bn(questions.filter((q) => q.options.length).length), "বহুনির্বাচনী বিকল্প"],
  ["১০০%", "বাংলায়"],
]
  .map(([v, k]) => `<li><b>${v}</b><span>${k}</span></li>`)
  .join("");

/* ---------- front matter ---------- */
$("#frontMatter").innerHTML = G.front
  .map((f) => {
    const body = f.blocks
      .map((b) => (b.type === "li" ? `<li>${b.text}</li>` : `<p>${b.text}</p>`))
      .join("");
    const inner = f.blocks.some((b) => b.type === "li") && !f.blocks.some((b) => b.type === "p")
      ? `<ul>${body}</ul>`
      : body;
    return `<section class="front-card"><h2>${f.title}</h2>${inner}</section>`;
  })
  .join("");

/* ---------- sections ---------- */
$("#sections").innerHTML = G.sections
  .map((s, si) => {
    const qs = s.questions
      .map(
        (q) => `
      <article class="q" id="q-${q.n}" data-n="${q.n}" data-text="${(q.title + " " + q.answer + " " + q.options.join(" ") + " " + q.note).toLowerCase()}">
        <button class="q-head" aria-expanded="false">
          <span class="q-num">${bn(q.n)}</span>
          <span class="q-title">${q.title}</span>
          <span class="q-check" role="checkbox" title="প্রস্তুত হিসেবে চিহ্নিত করুন">✓</span>
        </button>
        <div class="q-body">
          ${q.options.length ? `<p class="opts-label">বিকল্প</p><ul class="opts">${q.options.map((o) => `<li>${o}</li>`).join("")}</ul>` : ""}
          <p class="answer">${q.answer}</p>
          ${q.note ? `<div class="note"><b>মনে রাখবেন</b><span>${q.note}</span></div>` : ""}
        </div>
      </article>`
      )
      .join("");
    return `<section id="sec-${si}">
      <header class="section-head">
        <p class="kicker">অংশ ${bn(si + 1)} · প্রশ্ন ${bn(s.questions[0].n)}–${bn(s.questions[s.questions.length - 1].n)}</p>
        <h2>${s.title}</h2>
        ${s.subtitle ? `<p class="sub">${s.subtitle}</p>` : ""}
      </header>
      ${qs}
    </section>`;
  })
  .join("");

/* ---------- toc ---------- */
$("#toc").innerHTML = G.sections
  .map(
    (s, si) => `
    <div class="toc-group">
      <a class="toc-title" href="#sec-${si}">${s.title}<em>${bn(s.questions.length)}</em></a>
      <ul class="toc-list">
        ${s.questions
          .map((q) => `<li><a href="#q-${q.n}" data-n="${q.n}"><span>${bn(q.n)}</span>${q.title}</a></li>`)
          .join("")}
      </ul>
    </div>`
  )
  .join("");

/* ---------- progress ---------- */
function paintProgress() {
  const pct = Math.round((done.size / questions.length) * 100);
  $("#progressBar").style.width = pct + "%";
  $("#progressText").textContent = bn(pct) + "%";
  questions.forEach((q) => {
    document.getElementById("q-" + q.n)?.classList.toggle("done", done.has(q.n));
  });
}
function toggleDone(n) {
  done.has(n) ? done.delete(n) : done.add(n);
  localStorage.setItem(STORE_KEY, JSON.stringify([...done]));
  paintProgress();
}
paintProgress();
$("#resetProgress").onclick = () => {
  done.clear();
  localStorage.setItem(STORE_KEY, "[]");
  paintProgress();
};

/* ---------- accordion ---------- */
function open(q, state) {
  const el = document.getElementById("q-" + q);
  if (!el) return;
  el.classList.toggle("open", state);
  el.querySelector(".q-head").setAttribute("aria-expanded", state);
}

document.addEventListener("click", (e) => {
  const check = e.target.closest(".q-check");
  if (check) {
    e.stopPropagation();
    toggleDone(+check.closest(".q").dataset.n);
    return;
  }
  const head = e.target.closest(".q-head");
  if (head) open(+head.closest(".q").dataset.n, !head.closest(".q").classList.contains("open"));
});

/* keep the first question of each section open on first visit */
const seen = new Set(JSON.parse(localStorage.getItem(OPEN_KEY) || "[]"));
G.sections.forEach((s, si) => {
  if (!seen.has(si)) {
    open(s.questions[0].n, true);
    seen.add(si);
  }
});
localStorage.setItem(OPEN_KEY, JSON.stringify([...seen]));

/* ---------- search ---------- */
const search = $("#search");
const note = $("#resultsNote");
function runSearch() {
  const term = search.value.trim().toLowerCase();
  let hits = 0;
  questions.forEach((q) => {
    const el = document.getElementById("q-" + q.n);
    const match = !term || el.dataset.text.includes(term);
    el.classList.toggle("hide", !match);
    if (match) hits++;
  });
  G.sections.forEach((s, si) => {
    const visible = s.questions.some((q) => !document.getElementById("q-" + q.n).classList.contains("hide"));
    document.getElementById("sec-" + si).style.display = visible ? "" : "none";
  });
  note.hidden = !term;
  note.textContent = term ? `“${search.value.trim()}” — ${bn(hits)}টি প্রশ্নে পাওয়া গেছে` : "";
}
search.addEventListener("input", runSearch);
document.addEventListener("keydown", (e) => {
  if (e.key === "/" && document.activeElement !== search) {
    e.preventDefault();
    search.focus();
  } else if (e.key === "Escape" && document.activeElement === search) {
    search.value = "";
    runSearch();
    search.blur();
  }
});

/* ---------- nav ---------- */
document.querySelectorAll('a[href^="#q-"]').forEach((a) =>
  a.addEventListener("click", () => {
    const n = +a.dataset.n;
    open(n, true);
    document.getElementById("q-" + n)?.scrollIntoView({ block: "start", behavior: "smooth" });
    $("#sidebar").classList.remove("open");
  })
);

$("#startBtn").onclick = () => {
  $("#sec-0").scrollIntoView({ behavior: "smooth" });
};
$("#printBtn").onclick = () => window.print();
$("#menuToggle").onclick = () => $("#sidebar").classList.toggle("open");

/* ---------- scroll spy ---------- */
const links = new Map([...document.querySelectorAll('.toc-list a[data-n]')].map((a) => [+a.dataset.n, a]));
const spy = new IntersectionObserver(
  (entries) => {
    entries.forEach((en) => {
      if (!en.isIntersecting) return;
      const n = +en.target.dataset.n;
      links.forEach((a) => a.classList.remove("active"));
      links.get(n)?.classList.add("active");
    });
  },
  { rootMargin: "-20% 0px -70% 0px" }
);
document.querySelectorAll(".q").forEach((q) => spy.observe(q));
