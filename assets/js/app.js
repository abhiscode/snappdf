/* SnapPDF — all conversion client-side. Nothing leaves this device. */
(function () {
  "use strict";
  var MAX_SIDE = 3000;
  var PAGE_SIZES = { a4: [595.28, 841.89], letter: [612, 792] };
  var MARGINS = { none: 0, small: 24, large: 48 };

  var files = [];
  var drop = document.getElementById("dropzone");
  var input = document.getElementById("fileinput");
  var list = document.getElementById("filelist");
  var convertBtn = document.getElementById("convert");
  var progress = document.getElementById("progress");
  var progressBar = progress.querySelector("i");
  var doneCard = document.getElementById("done");
  var doneName = document.getElementById("done-name");
  var doneSize = document.getElementById("done-size");
  var errBox = document.getElementById("err");
  var errMsg = document.getElementById("err-msg");
  var startOver = document.getElementById("startover");
  var fnameInput = document.getElementById("fname");
  var busy = false;

  function showErr(msg) {
    errMsg.textContent = msg;
    errBox.classList.add("on");
  }
  document.getElementById("err-close").addEventListener("click", function () {
    errBox.classList.remove("on");
  });

  function fmtSize(b) {
    return b > 1048576 ? (b / 1048576).toFixed(1) + " MB" : Math.max(1, Math.round(b / 1024)) + " KB";
  }

  function addFiles(fileList) {
    var added = false;
    for (var i = 0; i < fileList.length; i++) {
      var f = fileList[i];
      if (!/^image\//.test(f.type)) {
        showErr("\u201c" + f.name + "\u201d isn't an image format SnapPDF reads — skipped.");
        continue;
      }
      files.push({ file: f, url: URL.createObjectURL(f), name: f.name, size: f.size });
      added = true;
    }
    if (added) { render(); hideDone(); }
  }

  function hideDone() { doneCard.classList.remove("on"); }

  function render() {
    list.innerHTML = "";
    files.forEach(function (item, idx) {
      var d = document.createElement("div");
      d.className = "thumb";
      d.draggable = true;
      d.dataset.idx = idx;
      var img = document.createElement("img");
      img.src = item.url;
      img.alt = "";
      var rm = document.createElement("button");
      rm.className = "rm"; rm.type = "button"; rm.title = "Remove"; rm.textContent = "×";
      rm.addEventListener("click", function () { removeAt(idx); });
      var ord = document.createElement("div");
      ord.className = "ord";
      var l = document.createElement("button"); l.type = "button"; l.textContent = "←"; l.title = "Move earlier";
      var r = document.createElement("button"); r.type = "button"; r.textContent = "→"; r.title = "Move later";
      l.addEventListener("click", function () { move(idx, -1); });
      r.addEventListener("click", function () { move(idx, 1); });
      ord.appendChild(l); ord.appendChild(r);
      d.appendChild(img); d.appendChild(rm); d.appendChild(ord);
      d.addEventListener("dragstart", function (e) {
        e.dataTransfer.setData("text/plain", idx);
        d.classList.add("dragging");
      });
      d.addEventListener("dragend", function () { d.classList.remove("dragging"); });
      list.appendChild(d);
    });
    convertBtn.disabled = files.length === 0 || busy;
  }

  function removeAt(i) {
    URL.revokeObjectURL(files[i].url);
    files.splice(i, 1);
    render();
  }
  function move(i, dir) {
    var j = i + dir;
    if (j < 0 || j >= files.length) return;
    var t = files[i]; files[i] = files[j]; files[j] = t;
    render();
  }

  list.addEventListener("dragover", function (e) {
    e.preventDefault();
    var t = e.target.closest(".thumb");
    if (!t) return;
    var rect = t.getBoundingClientRect();
    t.dataset.after = (e.clientX - rect.left) > rect.width / 2 ? "1" : "";
  });
  list.addEventListener("drop", function (e) {
    e.preventDefault();
    var from = parseInt(e.dataTransfer.getData("text/plain"), 10);
    var t = e.target.closest(".thumb");
    if (isNaN(from) || !t) return;
    var to = parseInt(t.dataset.idx, 10) + (t.dataset.after ? 1 : 0);
    var item = files.splice(from, 1)[0];
    files.splice(to > from ? to - 1 : to, 0, item);
    render();
  });

  drop.addEventListener("click", function () { input.click(); });
  drop.addEventListener("keydown", function (e) {
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); input.click(); }
  });
  drop.addEventListener("dragover", function (e) { e.preventDefault(); drop.classList.add("over"); });
  drop.addEventListener("dragleave", function () { drop.classList.remove("over"); });
  drop.addEventListener("drop", function (e) {
    e.preventDefault(); drop.classList.remove("over");
    addFiles(e.dataTransfer.files);
  });
  input.addEventListener("change", function () {
    addFiles(input.files);
    input.value = "";
  });

  function loadImage(url) {
    return new Promise(function (res, rej) {
      var img = new Image();
      img.onload = function () { res(img); };
      img.onerror = rej;
      img.src = url;
    });
  }

  function toJpeg(img) {
    var w = img.naturalWidth, h = img.naturalHeight;
    var scale = Math.min(1, MAX_SIDE / Math.max(w, h));
    w = Math.round(w * scale); h = Math.round(h * scale);
    var c = document.createElement("canvas");
    c.width = w; c.height = h;
    var ctx = c.getContext("2d");
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(img, 0, 0, w, h);
    return { url: c.toDataURL("image/jpeg", 0.92), w: w, h: h };
  }

  function pageFrame(imgW, imgH) {
    var sizeSel = document.getElementById("opt-size").value;
    var orient = document.getElementById("opt-orient").value;
    var margin = MARGINS[document.getElementById("opt-margin").value];
    if (sizeSel === "fit") return { w: imgW, h: imgH, margin: 0 };
    var pw = PAGE_SIZES[sizeSel][0], ph = PAGE_SIZES[sizeSel][1];
    var landscape = orient === "landscape" || (orient === "auto" && imgW > imgH);
    if (landscape) { var t = pw; pw = ph; ph = t; }
    return { w: pw, h: ph, margin: margin };
  }

  convertBtn.addEventListener("click", function () {
    if (!files.length || busy) return;
    busy = true;
    hideDone();
    convertBtn.disabled = true;
    progress.classList.add("on");
    var jsPDF = window.jspdf.jsPDF;
    var doc = null;
    var i = 0;

    function step() {
      if (i >= files.length) { finish(); return; }
      var item = files[i];
      progressBar.style.width = Math.round((i / files.length) * 100) + "%";
      loadImage(item.url).then(function (img) {
        var r = toJpeg(img);
        var pf = pageFrame(r.w, r.h);
        var orient = r.w > r.h ? "l" : "p";
        if (!doc) {
          doc = new jsPDF({ unit: "pt", format: [pf.w, pf.h], orientation: orient, compress: true });
        } else {
          doc.addPage([pf.w, pf.h], orient);
        }
        var iw = pf.w - pf.margin * 2, ih = pf.h - pf.margin * 2;
        var s = Math.min(iw / r.w, ih / r.h, 1);
        var dw = r.w * s, dh = r.h * s;
        doc.addImage(r.url, "JPEG", (pf.w - dw) / 2, (pf.h - dh) / 2, dw, dh);
        i++;
        // yield so progress paints
        setTimeout(step, 0);
      }).catch(function () {
        showErr("Couldn't read \u201c" + item.name + "\u201d — it may be corrupted. Skipped.");
        i++;
        step();
      });
    }

    function finish() {
      progressBar.style.width = "100%";
      var name = (fnameInput.value || "document").replace(/\.pdf$/i, "") + ".pdf";
      var blob = doc.output("blob");
      var url = URL.createObjectURL(blob);
      doneName.textContent = name;
      doneSize.textContent = files.length + " page" + (files.length > 1 ? "s" : "") + " · " + fmtSize(blob.size);
      var a = document.getElementById("download");
      a.href = url; a.download = name;
      doneCard.classList.add("on");
      busy = false;
      render();
      setTimeout(function () { progress.classList.remove("on"); progressBar.style.width = "0"; }, 600);
    }
    step();
  });

  startOver.addEventListener("click", function () {
    files.forEach(function (f) { URL.revokeObjectURL(f.url); });
    files = [];
    hideDone();
    render();
  });

  /* scroll reveal */
  if ("IntersectionObserver" in window && !window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    var io = new IntersectionObserver(function (es) {
      es.forEach(function (e) { if (e.isIntersecting) { e.target.classList.add("in"); io.unobserve(e.target); } });
    }, { threshold: 0.15 });
    document.querySelectorAll(".reveal").forEach(function (el) { io.observe(el); });
  } else {
    document.querySelectorAll(".reveal").forEach(function (el) { el.classList.add("in"); });
  }

  render();
})();
