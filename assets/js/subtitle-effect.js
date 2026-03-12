(function () {
  var config = window.subtitleEffectConfig;
  if (!config || !config.strings) return;

  var el = document.querySelector(".site-subtitle");
  if (!el) return;

  // --- Effect Registry ---
  // To add a new effect: add a function here, then use type: youreffect in _config.yml
  var effects = {
    typewriter: function (el, config) {
      var strings = config.strings;
      var typeSpeed = config.typeSpeed || 80;
      var backSpeed = config.backSpeed || 40;
      var backDelay = config.backDelay || 2000;
      var startDelay = config.startDelay || 500;

      var textEl = document.createElement("span");
      var cursor = document.createElement("span");
      cursor.className = "subtitle-cursor";
      cursor.textContent = "|";
      el.textContent = "";
      el.appendChild(textEl);
      el.appendChild(cursor);

      var stringIndex = 0;
      var charIndex = 0;
      var isDeleting = false;

      function tick() {
        var current = strings[stringIndex];

        if (isDeleting) {
          charIndex--;
          textEl.textContent = current.substring(0, charIndex);
          if (charIndex === 0) {
            isDeleting = false;
            stringIndex = (stringIndex + 1) % strings.length;
            setTimeout(tick, startDelay);
          } else {
            setTimeout(tick, backSpeed);
          }
        } else {
          charIndex++;
          textEl.textContent = current.substring(0, charIndex);
          if (charIndex === current.length) {
            isDeleting = true;
            setTimeout(tick, backDelay);
          } else {
            setTimeout(tick, typeSpeed);
          }
        }
      }

      setTimeout(tick, startDelay);
    },

    decode: function (el, config) {
      var strings = config.strings;
      var decodeSpeed = config.decodeSpeed || 50;
      var backDelay = config.backDelay || 2000;
      var startDelay = config.startDelay || 500;
      var chars = "01";
      //"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*";

      var textEl = document.createElement("span");
      el.textContent = "";
      el.appendChild(textEl);

      var stringIndex = 0;

      function scramble(target, callback) {
        var iterations = 0;
        var interval = setInterval(function () {
          textEl.textContent = target
            .split("")
            .map(function (char, i) {
              if (char === " ") return " ";
              if (i < iterations) return target[i];
              return chars[Math.floor(Math.random() * chars.length)];
            })
            .join("");

          iterations += 1 / 3;
          if (iterations >= target.length) {
            clearInterval(interval);
            textEl.textContent = target;
            if (callback) callback();
          }
        }, decodeSpeed);
      }

      function next() {
        scramble(strings[stringIndex], function () {
          setTimeout(function () {
            stringIndex = (stringIndex + 1) % strings.length;
            next();
          }, backDelay);
        });
      }

      setTimeout(next, startDelay);
    },
  };

  // --- Run the selected effect ---
  var effectType = config.type || "typewriter";
  var effectFn = effects[effectType];
  if (effectFn) {
    effectFn(el, config);
  }
})();
