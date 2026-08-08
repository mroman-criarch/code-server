/**
 * Accessory key bar for touch devices without a physical keyboard.
 *
 * The iOS software keyboard offers no Escape, Control, Tab or arrow keys, which
 * makes the integrated terminal (and anything vim-like) unusable. This bar docks
 * above the software keyboard and synthesises those keystrokes.
 *
 * It lives in the code-server tree rather than in a VS Code patch so that
 * upstream churn in lib/vscode cannot break it.
 */
;(function () {
	"use strict"

	// Only engage on touch devices with no fine pointer. A desktop browser with a
	// touchscreen keeps its real keyboard and must not get the bar.
	const isTouchOnly =
		window.matchMedia("(hover: none) and (pointer: coarse)").matches && navigator.maxTouchPoints > 0
	if (!isTouchOnly) {
		return
	}

	/** Keys that are held down and applied to the next keystroke. */
	const MODIFIERS = ["ctrl", "alt", "shift", "meta"]

	/**
	 * Bar layout. `key`/`code`/`keyCode` follow the DOM UI Events spec so that
	 * xterm.js and Monaco resolve them the same way they resolve real keys.
	 * Entries with `text` insert a literal character instead of a keystroke.
	 */
	const LAYOUT = [
		{ label: "esc", key: "Escape", code: "Escape", keyCode: 27 },
		{ label: "tab", key: "Tab", code: "Tab", keyCode: 9 },
		{ label: "ctrl", modifier: "ctrl" },
		{ label: "alt", modifier: "alt" },
		{ label: "◀", key: "ArrowLeft", code: "ArrowLeft", keyCode: 37 },
		{ label: "▼", key: "ArrowDown", code: "ArrowDown", keyCode: 40 },
		{ label: "▲", key: "ArrowUp", code: "ArrowUp", keyCode: 38 },
		{ label: "▶", key: "ArrowRight", code: "ArrowRight", keyCode: 39 },
		{ label: "|", text: "|" },
		{ label: "~", text: "~" },
		{ label: "/", text: "/" },
		{ label: "-", text: "-" },
		{ label: "_", text: "_" },
		{ label: "$", text: "$" },
		{ label: "{", text: "{" },
		{ label: "}", text: "}" },
		{ label: "[", text: "[" },
		{ label: "]", text: "]" },
		{ label: "home", key: "Home", code: "Home", keyCode: 36 },
		{ label: "end", key: "End", code: "End", keyCode: 35 },
	]

	/** Modifier name -> KeyboardEvent init property. */
	const MODIFIER_PROPERTY = {
		ctrl: "ctrlKey",
		alt: "altKey",
		shift: "shiftKey",
		meta: "metaKey",
	}

	/**
	 * Sticky modifier state. A single tap arms the modifier for one keystroke; a
	 * second tap locks it until tapped again. This mirrors how iPadOS and most
	 * terminal apps handle accessory modifiers.
	 */
	const armed = new Set()
	const locked = new Set()

	let bar = null

	/**
	 * The element that should receive synthesised events. xterm.js and Monaco both
	 * keep a hidden textarea focused while the user types, so the active element is
	 * the correct target; we only fall back when focus escaped to the body.
	 */
	function getTarget() {
		const active = document.activeElement
		if (active && active !== document.body && active.tagName !== "HTML") {
			return active
		}
		// Prefer the terminal, since that is what the bar mainly exists for.
		return (
			document.querySelector(".xterm-helper-textarea") ||
			document.querySelector(".inputarea") ||
			document.body
		)
	}

	function modifierInit() {
		const init = { ctrlKey: false, altKey: false, shiftKey: false, metaKey: false }
		for (const name of MODIFIERS) {
			if (armed.has(name) || locked.has(name)) {
				init[MODIFIER_PROPERTY[name]] = true
			}
		}
		return init
	}

	/** Clear one-shot modifiers after a keystroke consumed them. */
	function consumeArmed() {
		if (armed.size === 0) {
			return
		}
		armed.clear()
		render()
	}

	function sendKey(spec) {
		const target = getTarget()
		const init = Object.assign(modifierInit(), {
			key: spec.key,
			code: spec.code,
			keyCode: spec.keyCode,
			which: spec.keyCode,
			bubbles: true,
			cancelable: true,
			composed: true,
		})

		const down = new KeyboardEvent("keydown", init)
		// xterm.js and Monaco read keyCode/which, which the constructor does not set
		// from the init dictionary. Define them explicitly.
		Object.defineProperty(down, "keyCode", { get: () => spec.keyCode })
		Object.defineProperty(down, "which", { get: () => spec.keyCode })

		const accepted = target.dispatchEvent(down)
		if (accepted) {
			const up = new KeyboardEvent("keyup", init)
			Object.defineProperty(up, "keyCode", { get: () => spec.keyCode })
			Object.defineProperty(up, "which", { get: () => spec.keyCode })
			target.dispatchEvent(up)
		}
		consumeArmed()
	}

	/**
	 * Insert a literal character. Synthetic keydown events do not produce text in
	 * either xterm.js or Monaco (both read text from input/beforeinput), so route
	 * printable characters through the editing pipeline instead.
	 */
	function sendText(text) {
		const target = getTarget()

		// A modifier is armed, so the user means a chord (e.g. ctrl+c), not literal text.
		if (armed.size > 0 || locked.size > 0) {
			const upper = text.toUpperCase()
			sendKey({ key: text, code: "Key" + upper, keyCode: upper.charCodeAt(0) })
			return
		}

		target.focus()
		// execCommand is deprecated but is the only cross-browser way to insert text
		// with the beforeinput/input events that xterm.js and Monaco listen for.
		if (!document.execCommand("insertText", false, text)) {
			target.dispatchEvent(new InputEvent("input", { data: text, bubbles: true, composed: true }))
		}
	}

	function toggleModifier(name) {
		if (locked.has(name)) {
			locked.delete(name)
		} else if (armed.has(name)) {
			armed.delete(name)
			locked.add(name)
		} else {
			armed.add(name)
		}
		render()
	}

	function render() {
		if (!bar) {
			return
		}
		for (const button of bar.querySelectorAll("[data-modifier]")) {
			const name = button.dataset.modifier
			button.classList.toggle("is-armed", armed.has(name))
			button.classList.toggle("is-locked", locked.has(name))
		}
	}

	function build() {
		bar = document.createElement("div")
		bar.className = "cs-mobile-keyboard"
		bar.setAttribute("role", "toolbar")
		bar.setAttribute("aria-label", "Accessory keys")

		for (const spec of LAYOUT) {
			const button = document.createElement("button")
			button.type = "button"
			button.className = "cs-mobile-keyboard__key"
			button.textContent = spec.label
			button.setAttribute("aria-label", spec.label)
			if (spec.modifier) {
				button.dataset.modifier = spec.modifier
			}

			button.addEventListener("click", () => {
				if (spec.modifier) {
					toggleModifier(spec.modifier)
				} else if (spec.text !== undefined) {
					sendText(spec.text)
				} else {
					sendKey(spec)
				}
			})

			bar.appendChild(button)
		}

		// Critical: pressing a button must not blur the focused textarea, or iOS
		// dismisses the software keyboard and the bar disappears with it.
		bar.addEventListener("pointerdown", (event) => event.preventDefault())
		bar.addEventListener("mousedown", (event) => event.preventDefault())

		document.body.appendChild(bar)
		render()
	}

	/**
	 * Track the software keyboard. visualViewport shrinks when the keyboard opens;
	 * that difference is the only reliable signal iOS Safari gives us.
	 */
	function trackViewport() {
		const viewport = window.visualViewport
		if (!viewport) {
			return
		}

		const update = () => {
			const occluded = window.innerHeight - viewport.height - viewport.offsetTop
			const keyboardOpen = occluded > 120

			document.body.classList.toggle("cs-mobile-keyboard-visible", keyboardOpen)
			if (bar) {
				// Dock the bar to the top edge of the keyboard.
				bar.style.transform = `translateY(${-occluded}px)`
			}
		}

		viewport.addEventListener("resize", update)
		viewport.addEventListener("scroll", update)
		update()
	}

	function init() {
		build()
		trackViewport()
	}

	if (document.readyState === "loading") {
		document.addEventListener("DOMContentLoaded", init)
	} else {
		init()
	}
})()
