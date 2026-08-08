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
		// Atalhos do workbench (⌘P, ⌘S, ⌘B) resolvem CtrlCmd como Meta no iOS,
		// entao `ctrl` sozinho nao os alcanca — ele serve pro terminal, onde
		// Ctrl e Ctrl de verdade. As duas teclas existem por motivos distintos.
		{ label: "cmd", modifier: "meta" },
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
	 *
	 * Beyond positioning the bar this also shrinks the workbench, because iOS does
	 * not reflow the page for the software keyboard: without this the terminal's
	 * last rows (the ones you are actually typing into) sit behind the keyboard.
	 */
	function trackViewport() {
		const viewport = window.visualViewport
		if (!viewport) {
			return
		}

		let lastInset = -1

		const update = () => {
			const occluded = Math.max(0, window.innerHeight - viewport.height - viewport.offsetTop)
			const keyboardOpen = occluded > 120
			// The bar only takes space while it is displayed.
			const inset = keyboardOpen ? occluded + barHeight() : 0

			document.body.classList.toggle("cs-mobile-keyboard-visible", keyboardOpen)
			if (bar) {
				bar.style.transform = `translateY(${-occluded}px)`
			}

			if (inset !== lastInset) {
				lastInset = inset
				document.documentElement.style.setProperty("--cs-keyboard-inset", `${inset}px`)
				// VS Code lays out from measured element sizes and only re-measures on
				// resize, so the CSS change alone leaves the workbench stale.
				window.dispatchEvent(new Event("resize"))
			}

			// iOS scrolls the whole document to reveal the focused field, which drags
			// the fixed workbench out of view. Undo it; the shrink above already made
			// room for the caret.
			if (keyboardOpen && window.scrollY !== 0) {
				window.scrollTo(0, 0)
			}
		}

		viewport.addEventListener("resize", update)
		viewport.addEventListener("scroll", update)
		window.addEventListener("orientationchange", () => setTimeout(update, 300))
		update()
	}

	function barHeight() {
		return bar && bar.offsetHeight ? bar.offsetHeight : 52
	}

	/**
	 * The modifier that VS Code's `CtrlCmd` resolves to here. It is Meta on Apple
	 * platforms and Control everywhere else, and iOS counts as Apple — so a
	 * workbench keybinding written as CtrlCmd+B is Cmd+B on the iPhone. Sending
	 * ctrlKey there does nothing at all.
	 */
	function ctrlCmd() {
		// Both strings, not one falling back to the other: navigator.platform is
		// non-empty on every engine, so `platform || userAgent` would never reach
		// the userAgent — and it is the userAgent that carries "iPhone" when the
		// platform string does not.
		const apple = /Mac|iPhone|iPad|iPod/.test(navigator.platform + " " + navigator.userAgent)
		return apple ? { metaKey: true } : { ctrlKey: true }
	}

	/**
	 * Dispatch a chord straight to the workbench, bypassing the bar's sticky
	 * modifier state (which sendKey folds in, and which must not leak into a
	 * keystroke the user did not press).
	 */
	function sendChord(spec) {
		const target = document.querySelector(".monaco-workbench") || document.body
		const init = {
			key: spec.key,
			code: spec.code,
			keyCode: spec.keyCode,
			which: spec.keyCode,
			ctrlKey: !!spec.ctrlKey,
			altKey: !!spec.altKey,
			shiftKey: !!spec.shiftKey,
			metaKey: !!spec.metaKey,
			bubbles: true,
			cancelable: true,
			composed: true,
		}
		for (const type of ["keydown", "keyup"]) {
			const event = new KeyboardEvent(type, init)
			Object.defineProperty(event, "keyCode", { get: () => spec.keyCode })
			Object.defineProperty(event, "which", { get: () => spec.keyCode })
			target.dispatchEvent(event)
		}
	}

	/**
	 * Collapse the side bar the first time the workbench opens on a narrow
	 * screen. At 390px the explorer takes 170px of a 390px viewport, leaving the
	 * editor too narrow to read code in.
	 *
	 * Done by firing ctrl+b (workbench.action.toggleSidebarVisibility) rather
	 * than by hiding the part in CSS: the workbench lays out through a grid whose
	 * track sizes it owns, so hiding a part behind its back leaves the freed
	 * space empty instead of giving it to the editor. Going through the
	 * keybinding lets the layout engine reflow on its own terms.
	 *
	 * Once only, recorded in localStorage. VS Code already persists side bar
	 * visibility per workspace, so this is a first-run nudge — reopening the
	 * explorer afterwards is a choice we must not keep overriding on every load.
	 */
	function nudgeNarrowLayout() {
		const KEY = "cs-mobile-sidebar-nudged"
		if (window.innerWidth > 600) {
			return
		}
		try {
			if (localStorage.getItem(KEY)) {
				return
			}
		} catch (e) {
			return // Private mode with storage denied: skip rather than nag every load.
		}

		// The workbench mounts well after DOMContentLoaded, so wait for the part
		// to exist and have been given a width before deciding anything.
		let tries = 0
		const timer = setInterval(() => {
			const sidebar = document.querySelector(".part.sidebar")
			const visible = sidebar && sidebar.getBoundingClientRect().width > 0
			if (visible) {
				clearInterval(timer)
				try {
					localStorage.setItem(KEY, "1")
				} catch (e) {
					/* best effort */
				}
				sendChord(Object.assign({ key: "b", code: "KeyB", keyCode: 66 }, ctrlCmd()))
			} else if (++tries > 40) {
				clearInterval(timer)
			}
		}, 500)
	}

	/**
	 * Label the home screen icon with the configured app name.
	 *
	 * iOS takes that label from apple-mobile-web-app-title, not from the web app
	 * manifest, and the workbench ships that tag hardcoded to "Code" — so
	 * --app-name reaches the manifest and the title bar but never the icon. The
	 * name is read back from the product configuration the page already carries,
	 * which avoids both a fetch and a patch to the HTML (a patch would mean
	 * recompiling the VS Code build for a string).
	 */
	function fixAppleAppTitle() {
		const meta = document.querySelector('meta[name="apple-mobile-web-app-title"]')
		if (!meta) {
			return
		}
		try {
			const el = document.getElementById("vscode-workbench-web-configuration")
			const config = JSON.parse(el.getAttribute("data-settings"))
			const name = config.productConfiguration && config.productConfiguration.nameShort
			if (name) {
				meta.setAttribute("content", name)
			}
		} catch (e) {
			/* Leave the shipped default rather than guess. */
		}
	}

	function init() {
		// Gate for every touch-only rule in the stylesheets. Set from JS rather
		// than with a media query so that the CSS cannot apply on a desktop
		// browser that merely reports a coarse pointer — this script has already
		// decided, above, that this is a touch-only device.
		document.body.classList.add("cs-mobile-touch")
		build()
		trackViewport()
		nudgeNarrowLayout()
		fixAppleAppTitle()
	}

	if (document.readyState === "loading") {
		document.addEventListener("DOMContentLoaded", init)
	} else {
		init()
	}
})()
