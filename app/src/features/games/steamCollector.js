/* Recolector del inventario de Steam.
 *
 * Esto NO se ejecuta en Reel. Es el texto que se copia de la pestaña Steam y se
 * pega en la consola de una pestaña de Steam. Vive aquí, en el repo y en un solo
 * sitio, porque la app lo importa con `?raw` para ofrecerlo con su botón de
 * copiar: tenerlo también en un README daría dos copias y una envejecería.
 *
 * Se pega DOS VECES, en dos pestañas distintas, y hace algo distinto en cada
 * una — mira `IS_STORE` más abajo para el porqué:
 *
 *   · en `steamcommunity.com`, el inventario, los precios, el histórico y tus
 *     compras y ventas del mercado;
 *   · en `store.steampowered.com/account/history/`, el movimiento de la cartera:
 *     lo que metiste de tu bolsillo y lo que se te fue en juegos.
 *
 * ── Por qué se pega en una pestaña de Steam y no lo hace el servidor ──────
 * Tres barreras, y ninguna se rodea desde fuera:
 *
 *  1. `/inventory/…` está estrangulado por IP con una mano durísima. Medido el
 *     27-08-2026: la PRIMERA petición desde una IP doméstica limpia ya devuelve
 *     429. Desde la IP compartida de una edge function no es un riesgo, es el
 *     caso normal.
 *  2. `market/pricehistory` y `market/myhistory` contestan 400 sin la cookie de
 *     sesión. El truco antiguo de leer la serie incrustada en la página del
 *     listing (`var line1=[[…]]`) murió: hoy esa página son 5 MB sin una sola
 *     vela dentro.
 *  3. Y no vale con pegar esto y que suba solo: la CSP de `steamcommunity.com`
 *     trae un `connect-src` con lista blanca —Steam, Valve y poco más— que no
 *     incluye a Supabase. Un `fetch` desde aquí a Reel lo corta el navegador,
 *     venga de la consola o de donde venga. Por eso el resultado sale en
 *     FICHEROS y se sube a mano.
 *
 * ── Y por qué botones en vez de descargar solo ────────────────────────────
 * Chrome bloquea la SEGUNDA descarga automática de un sitio sin avisar de nada
 * (ya nos pasó con la importación de FilmAffinity: el fichero simplemente no
 * aparece en ~/Downloads). Una descarga disparada por un clic de verdad no
 * entra en esa cuenta, así que esto pinta un panel y espera a que pulses.
 */

(async () => {
  "use strict";

  /* ── Qué se recoge ────────────────────────────────────────────────────── */

  /* 730/2 es CS2 (skins, cápsulas y pegatinas) y 753/6 es el inventario de la
     comunidad de Steam (cromos, fondos, emoticonos y las pegatinas del punto).
     Son los dos que tienen mercado; el resto de appids son objetos de juego que
     no se venden y que solo alargarían la pasada. */
  const APPS = [
    { appid: 730, context: 2, label: "CS2" },
    { appid: 753, context: 6, label: "Steam" },
  ];

  /* 3 = EUR. Es el id de moneda de Valve, no ISO 4217. Steam no convierte: cada
     mercado regional tiene su propia oferta, así que pedir otra moneda no
     traduce el mismo precio, trae otro precio distinto. */
  const CURRENCY = 3;

  /* Hasta dónde se trae la vela DIARIA. Steam guarda desde 2013 y da el
     histórico entero de una vez: lo que no cabe es subirlo, porque un objeto que
     se mueve todos los días son mil filas por cada mil días y eso multiplicado
     por sesenta objetos son megas de JSON.

     Así que ya no se corta por fecha, se corta por RESOLUCIÓN: los dos últimos
     años, día a día, y lo de más atrás en un punto por trimestre. Un cromo de
     2013 pasa de cuatro mil velas a cincuenta y dos, que es todo lo que se
     necesita para ver que costaba treinta céntimos y hoy cuesta seis euros. */
  const HISTORY_DAILY_DAYS = 730;

  /* Para cuántos objetos. TODOS, desde el 29-08-2026.
     Eran los sesenta más valiosos, y el motivo escrito era que «la curva de una
     caja de 0,03 € no la va a abrir nadie». Con la pantalla ya hecha se vio que
     eso era verdad para la curva de la CARTERA —los otros 548 objetos de este
     inventario valen siete euros entre todos— y falso para todo lo demás:
       · la ficha de un objeto abre su gráfica, y con el tope decía «este
         todavía no tiene histórico» en 548 de 608 fichas, o sea en el 90 % de
         las veces que alguien pincha;
       · y la curva de la cartera marcaba «faltan 548 precios» los 731 días, un
         aviso permanente que no avisa de nada.
     Lo que cuesta: la pasada del histórico pasa de tres minutos a media hora, y
     el fichero de dos megas a unos trece. Por eso sigue siendo el SEGUNDO botón
     y el segundo fichero — quien solo quiera el valor de hoy ya lo tiene
     descargado antes de que esto empiece.
     Y lo que cuesta del otro lado, medido en local el 29-08-2026 con el peor
     caso de las dos cosas juntas —la ventana sin tope de 0094, o sea desde 2013,
     por estos 610 objetos: medio millón de velas y 820.000 celdas—:
     `rpc_steam_value_series` tarda 1,2-1,7 s y devuelve 1.340 puntos. Con solo
     sesenta objetos eran 0,5 s. Sigue muy por debajo del `statement_timeout`,
     pero es la cifra que hay que volver a mirar si alguien sube otra vez el
     techo: `p_days` es la salida de emergencia y sigue ahí.

     El tope se queda escrito por si algún día hace falta acotarlo: `null` es
     todos. El ORDEN por valor no es decorativo aunque ya no recorte nada — si
     cierras la pestaña a mitad, lo que se ha traído es lo que más pesa. */
  const HISTORY_TOP = null;

  /* ── Herramientas ─────────────────────────────────────────────────────── */

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  /** El SteamID64 de quien está mirando, que cada pestaña guarda en otro sitio.
   *
   *  `g_steamID` lo pone la comunidad. La TIENDA no lo pone —ahí hay
   *  `g_AccountID`, que son los 32 bits bajos del mismo número, y el bloque
   *  `#application_config` con la ficha entera—, así que mirar solo el primero
   *  mandaba media pasada al "no veo tu sesión" con la sesión abierta y el
   *  nombre en la esquina. Y el aviso de abajo remataba el enredo mandándote a
   *  la comunidad, que es justo la pestaña que NO tiene lo que ibas a leer. */
  function whoAmI() {
    const direct = String(window.g_steamID || "");
    if (/^\d{17}$/.test(direct)) return direct;
    try {
      const cfg = document.getElementById("application_config");
      const id = String(JSON.parse(cfg?.dataset?.userinfo || "{}").steamid || "");
      if (/^\d{17}$/.test(id)) return id;
    } catch {
      /* Ese bloque cambia de forma cada temporada. Si hoy no se deja leer,
         queda el accountid, que es aritmética y no depende de ningún HTML. */
    }
    const account = Number(window.g_AccountID || 0);
    if (Number.isInteger(account) && account > 0) {
      return String(BigInt(account) + 76561197960265728n);
    }
    return "";
  }

  const steamId = whoAmI();
  if (!/^\d{17}$/.test(steamId)) {
    alert(
      "No veo tu sesión de Steam.\n\n" +
        "Comprueba que arriba a la derecha sale tu nombre, en la pestaña donde " +
        "vayas a pegar esto:\n\n" +
        "  · https://steamcommunity.com/market/  — tu inventario\n" +
        "  · https://store.steampowered.com/account/history/  — tu cartera",
    );
    return;
  }

  /* ── Dónde se ha pegado esto, que decide qué se puede leer ─────────────── */
  //
  // El mismo texto sirve para las dos pestañas y hace una cosa distinta en cada
  // una, porque no hay forma de que haga las dos desde ninguna:
  //
  //   · steamcommunity.com → inventario, precios, histórico y tus compras y
  //     ventas del mercado.
  //   · store.steampowered.com → el movimiento de la CARTERA: lo que metiste de
  //     tu bolsillo y lo que se te fue en juegos.
  //
  // No se puede leer lo segundo desde lo primero. La CSP de la comunidad sí deja
  // pedirle a la tienda —`store.steampowered.com` está en su `connect-src`—,
  // pero la tienda no manda cabeceras CORS de vuelta, así que la petición sale y
  // la respuesta no se puede leer. Son dos orígenes distintos y punto.
  const WHERE = location.hostname.replace(/^www\./, "");
  const IS_STORE = WHERE === "store.steampowered.com";
  if (!IS_STORE && WHERE !== "steamcommunity.com") {
    alert(
      "Esto va pegado en una de estas dos pestañas:\n\n" +
        "  · https://steamcommunity.com/market/  — tu inventario\n" +
        "  · https://store.steampowered.com/account/history/  — tu cartera\n\n" +
        "Hacen falta las dos, una cada vez.",
    );
    return;
  }

  /** Un `fetch` que se rinde con criterio.
   *
   *  El 429 de Steam no es un error que reintentar deprisa: es "para". Se espera
   *  cada vez más (2s, 4s, 8s…) porque insistir cada segundo alarga el bloqueo
   *  en vez de acortarlo. Y `credentials: "include"` porque media pasada
   *  depende de tu cookie.
   *
   *  ── Y la dirección se pide ENTERA, no "/market/…" ────────────────────────
   *  Porque el `fetch` de la página puede no ser el del navegador. Medido el
   *  29-08-2026 pegando esto en `steamcommunity.com/id/<tu-id>/inventory`: el
   *  bundle de esa pantalla envuelve `window.fetch` —queda un
   *  `function(t){return n.apply(this,arguments)}` en vez del nativo— y esa
   *  envoltura construye un `new URL(...)` sin base, así que una ruta relativa
   *  revienta antes de salir a la red con «Failed to construct 'URL': Invalid
   *  URL».
   *
   *  Lo caro no fue el fallo sino su disfraz: como se lanza igual que un fallo
   *  de red, la fase de precios se comió sus cinco strikes en quince segundos y
   *  el panel concluyó «Steam no ha dado ni un precio», que era mentira —no
   *  llegó a preguntar—, y de paso se saltó el histórico entero.
   *
   *  `new URL(url, location.origin)` cuesta nada y quita la dependencia: con la
   *  dirección entera, la envoltura de turno no tiene que resolver nada. */
  async function get(url, { tries = 5 } = {}) {
    const entera = new URL(url, location.origin).toString();
    let wait = 2000;
    for (let i = 0; i < tries; i++) {
      const res = await fetch(entera, { credentials: "include" });
      if (res.ok) return res.json();
      if (res.status === 429 || res.status >= 500) {
        log(`  Steam dice "espera" (${res.status}); reintento en ${wait / 1000}s…`);
        await sleep(wait);
        wait *= 2;
        continue;
      }
      /* 403 en el inventario es el caso que más confunde, y no es un fallo del
         guión: es tu privacidad. Se dice con esas palabras. */
      if (res.status === 403) throw new Error("403 (¿inventario privado?)");
      throw new Error(String(res.status));
    }
    throw new Error("Steam sigue diciendo 429 después de varios intentos");
  }

  /** "32,93€" → 3293. También "€32.93", "$1,234.56" y "1 234,56 руб.".
   *
   *  Steam devuelve el precio ya formateado en el idioma de tu cuenta y no da la
   *  cifra cruda por ningún lado, así que hay que deshacer el formato. La regla
   *  que lo resuelve sin saber el idioma: el ÚLTIMO separador que tenga
   *  exactamente dos dígitos detrás son los decimales; cualquier otro punto o
   *  coma es de los miles y sobra.
   *
   *  El `replace` de la cola no es adorno: el rublo se escribe "1 234,56 руб."
   *  y ese punto final de la abreviatura sobrevive al primer filtro, rompe el
   *  match de los decimales y manda la cifra por la rama de "no hay decimales",
   *  que multiplica por cien. Un precio cien veces mayor sin que nada falle.
   *
   *  (Esta función está repetida en app/src/domain/steamPortfolio.ts, que es
   *  donde tiene sus pruebas. La copia vive aquí porque este fichero se pega
   *  entero en una consola ajena y no puede importar nada.) */
  function cents(text) {
    if (typeof text === "number") return Math.round(text * 100);
    if (!text) return null;
    const digits = String(text).replace(/[^\d.,]/g, "").replace(/[.,]+$/, "");
    if (!digits) return null;
    const m = digits.match(/[.,](\d{2})$/);
    if (!m) return Math.round(Number(digits.replace(/[.,]/g, "")) * 100);
    const whole = digits.slice(0, m.index).replace(/[.,]/g, "");
    return Number(whole || "0") * 100 + Number(m[1]);
  }

  /* ── El panel, que es toda la interfaz que hay ────────────────────────── */

  document.getElementById("reel-collector")?.remove();
  const panel = document.createElement("div");
  panel.id = "reel-collector";
  panel.style.cssText =
    "position:fixed;right:16px;bottom:16px;z-index:99999;width:380px;max-height:70vh;" +
    "overflow:auto;background:#1b2838;color:#c7d5e0;border:1px solid #66c0f4;" +
    "border-radius:8px;padding:14px;font:13px/1.5 system-ui,sans-serif;" +
    "box-shadow:0 8px 32px rgba(0,0,0,.6)";
  panel.innerHTML =
    '<div style="font-weight:700;color:#66c0f4;margin-bottom:8px">Reel · inventario de Steam</div>' +
    '<pre id="reel-log" style="margin:0;white-space:pre-wrap;font:12px/1.45 ui-monospace,monospace"></pre>' +
    '<div id="reel-buttons" style="margin-top:10px;display:flex;gap:8px;flex-wrap:wrap"></div>';
  document.body.appendChild(panel);

  const logEl = panel.querySelector("#reel-log");
  function log(line) {
    logEl.textContent += line + "\n";
    logEl.scrollTop = logEl.scrollHeight;
    console.log("[reel]", line);
  }

  /** Un botón que descarga un JSON. Con clic de por medio, que es lo que
   *  esquiva el bloqueo de descargas múltiples de Chrome. */
  function offer(label, name, payload) {
    const json = JSON.stringify(payload);
    const size = (json.length / 1024 / 1024).toFixed(2);
    const b = document.createElement("button");
    b.textContent = `${label} (${size} MB)`;
    b.style.cssText =
      "background:#66c0f4;color:#1b2838;border:0;border-radius:4px;padding:7px 12px;" +
      "font-weight:700;cursor:pointer";
    b.onclick = () => {
      const url = URL.createObjectURL(new Blob([json], { type: "application/json" }));
      const a = document.createElement("a");
      a.href = url;
      a.download = name;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
      b.textContent = "✓ " + label;
    };
    panel.querySelector("#reel-buttons").appendChild(b);
  }

  const base = {
    version: 1,
    steam_id: steamId,
    currency: CURRENCY,
    collected_at: new Date().toISOString(),
  };

  /* ── 0. La cartera, si esto se ha pegado en la tienda ──────────────────── */

  /** El movimiento de la cartera, de `store.steampowered.com/account/history`.
   *
   *  Es la mitad del dinero que la pantalla enseña —lo que metiste de tu
   *  bolsillo y lo que se te fue en juegos— y no hay ninguna API: es HTML, hay
   *  que rascarlo, y es la parte MENOS verificada de todo esto. Por eso cuenta
   *  las filas que ha entendido y las que no: unos ceros con "0 filas leídas"
   *  delante son un aviso, y unos ceros a secas parecen un dato.
   *
   *  Lo del MERCADO se salta a propósito. Esas filas aparecen también aquí, y ya
   *  las trae `myhistory` con su id estable y su nombre de objeto: contarlas dos
   *  veces duplicaría cada compra y cada venta y dejaría el realizado al doble. */
  if (IS_STORE) {
    log("Leyendo el movimiento de tu cartera…");

    /** El tipo de fila según el rótulo, que es una PISTA y no el veredicto.
     *
     *  La columna de tipo dice "Compra" también cuando recargas la cartera —lo
     *  de "fondos" vive en otra celda, y con el historial en inglés ni eso—, así
     *  que esta lista sola clasificaba las recargas de doce años como gasto en
     *  la tienda: cero euros en "de tu bolsillo" y esos mismos euros contados
     *  otra vez en la cesta de al lado. Quien decide es el signo del saldo, ahí
     *  abajo; esto solo distingue lo que el signo no puede. */
    const kindOf = (label) => {
      const s = label.toLowerCase();
      if (/mercado|market/.test(s)) return null; // ya viene por myhistory
      if (/reembolso|refund/.test(s)) return "refund";
      if (/fondos|funds|recarga|saldo|wallet credit|gift card/.test(s)) return "wallet_topup";
      if (/compra|purchase|pedido|order/.test(s)) return "store_purchase";
      return "other";
    };

    const rows = [];
    let unknown = 0;
    const seen = new Map();

    /** El trozo de HTML de "cargar más", convertido en algo recorrible.
     *
     *  El `<table>` de alrededor NO es adorno: la respuesta son `<tr>` sueltos,
     *  y `DOMParser` TIRA una fila que no tiene tabla donde vivir. El documento
     *  resultante conserva el texto —por eso no parecía roto— pero ni una sola
     *  fila, así que la paginación traía megas de HTML y sacaba cero filas de
     *  ellos, una página tras otra, sin un error por ninguna parte. Medido el
     *  28-08-2026 sobre la misma respuesta: 0 filas suelta, 995 dentro de una
     *  tabla. Es la razón de que el volcado de la cartera se quedara siempre en
     *  lo que ya estaba pintado en la página. */
    const parseRows = (html) =>
      new DOMParser().parseFromString(`<table>${html}</table>`, "text/html");

    /** Lee las filas de un documento y devuelve CUÁNTAS ha visto — vistas, no
     *  entendidas: es lo que distingue "esta página no traía nada" de "esta
     *  página traía cosas que no nos interesan". */
    const readTable = (doc) => {
      const found = doc.querySelectorAll(".wallet_table_row");
      for (const el of found) {
        const type = (el.querySelector(".wht_type")?.textContent || "").trim();
        let kind = kindOf(type);
        if (kind === null) continue;
        const rawDate = (el.querySelector(".wht_date")?.textContent || "").trim();
        /* El cambio de saldo es la cifra que importa; `wht_total` es lo que
           costó el pedido, que con un pago con tarjeta no toca la cartera. */
        const changeText = (el.querySelector(".wht_wallet_change")?.textContent || "").trim();
        const amount = cents(changeText);
        if (!rawDate || amount === null || amount === 0) {
          unknown += 1;
          continue;
        }
        /* El signo: Steam lo escribe delante, y cuando no lo escribe lo decide
           el tipo de fila. Una recarga suma, todo lo demás resta. */
        const negative = /^-|^−/.test(changeText)
          ? true
          : /^\+/.test(changeText)
            ? false
            : kind !== "wallet_topup" && kind !== "refund";
        /* Y aquí el saldo corrige al rótulo. Un ingreso es un ingreso lo llame
           Steam como lo llame y esté la página en el idioma que esté: si la
           cartera SUBE y no es una devolución, ese dinero entró de tu bolsillo.
           Al revés no hace falta hacerlo —lo que baja ya cae en su cesta por el
           rótulo—, y forzarlo convertiría un reembolso en una compra. */
        if (!negative && kind !== "refund") kind = "wallet_topup";
        /* Un id que sobreviva a que la lista crezca por arriba: la posición no
           vale —mañana esta fila estará una más abajo y se importaría dos
           veces—, así que se compone con lo que no cambia. El saldo resultante
           desempata dos filas idénticas de años distintos, y el contador
           desempata dos idénticas del mismo día.
           `kind` NO entra aquí, y esa ausencia es el arreglo: con él dentro,
           corregir una clasificación —lo que acaba de pasar con las recargas—
           le cambiaba el id a la fila, y la corregida entraba al lado de la
           equivocada en vez de encima. Un id identifica la fila de Steam, no lo
           que nosotros creamos hoy que significa. */
        const balance = (el.querySelector(".wht_total")?.textContent || "").trim();
        const stem = `wallet_${rawDate}_${changeText}_${balance}`;
        const n = seen.get(stem) ?? 0;
        seen.set(stem, n + 1);
        rows.push({
          external_id: `${stem}_${n}`,
          raw_date: rawDate,
          kind,
          amount_cents: negative ? -Math.abs(amount) : Math.abs(amount),
          order: rows.length,
        });
      }
      return found.length;
    };

    readTable(document);
    log(`  ${rows.length} filas en la página…`);

    /* El resto llega por el botón de "cargar más", que es una petición con el
       cursor de la última fila. Sin sessionid no hay nada que pedir, y eso pasa
       si esto se pega en una página de la tienda que no es el historial. */
    /* ¿Se ha leído el historial ENTERO? Reel barre las filas viejas de la
       cartera cuando el volcado está completo —es la única forma de que
       corregir una clasificación no deje la fila vieja al lado de la nueva—, y
       barrer con una lectura a medias sería borrar años de movimientos porque
       la tienda cortó en la página doce. Así que se dice la verdad. */
    let complete = true;
    const sessionid = document.cookie.match(/sessionid=([^;]+)/)?.[1];
    const cursorEl = document.querySelector("#load_more_button, [data-cursor]");
    if (!sessionid || !cursorEl) {
      complete = false;
      log("  No veo el botón de «cargar más»: esto va pegado en");
      log("  https://store.steampowered.com/account/history/");
    } else {
      /** De dónde sale el cursor de la siguiente página.
       *
       *  Hoy la tienda lo tiene en la global `g_historyCursor` y el botón no
       *  lleva ningún `data-cursor` —lo comprobado el 28-08-2026: el botón
       *  existe, su atributo es null y su `onclick` llama a
       *  `WalletHistory_LoadMore()`, que lee la global—. El atributo se sigue
       *  mirando primero porque no cuesta nada y porque Valve mueve estas cosas
       *  sin avisar; lo que no puede volver a pasar es que no encontrarlo se
       *  quede en 54 filas de la primera página y nadie se entere.
       *
       *  Y el que se lee es el que hay AL PRINCIPIO: `WalletHistory_LoadMore`
       *  actualiza la global a medida que carga, así que leerla dentro del
       *  bucle sería seguir el rastro de dos paginaciones a la vez. */
      let cursor = null;
      try {
        cursor = JSON.parse(cursorEl.getAttribute("data-cursor") || "null");
      } catch {
        cursor = null;
      }
      if (!cursor && window.g_historyCursor && typeof window.g_historyCursor === "object") {
        cursor = { ...window.g_historyCursor };
      }
      /* Ni atributo ni global: hay páginas que no vamos a poder pedir, así que
         esto NO es una lectura completa por mucho que el bucle no llegue a dar
         una vuelta. */
      if (!cursor) {
        complete = false;
        log("  No encuentro el cursor de la siguiente página; me quedo con esta.");
      }
      let page = 0;
      for (; cursor && page < 60; page++) {
        const body = new URLSearchParams({ sessionid });
        for (const [k, v] of Object.entries(cursor)) body.set(`cursor[${k}]`, String(v));
        /* Entera y no relativa, por lo mismo que en `get`: el `fetch` de la
           página puede estar envuelto y no saber resolver una ruta. */
        const res = await fetch(new URL("/account/AjaxLoadMoreHistory/", location.origin), {
          method: "POST",
          credentials: "include",
          headers: { "content-type": "application/x-www-form-urlencoded" },
          body,
        });
        if (!res.ok) {
          complete = false;
          log(`  La tienda ha cortado en ${rows.length} filas (${res.status}).`);
          break;
        }
        const data = await res.json();
        if (!data.html) {
          /* Sin filas y sin cursor es el final de la lista. Sin filas PERO con
             cursor es un tropiezo de Steam a media lectura, y tratarlo como
             final autorizaría a barrer el libro entero con un tercio de las
             filas en la mano. */
          if (data.cursor) complete = false;
          break;
        }
        const vistas = readTable(parseRows(data.html));
        /* Página con HTML pero sin una sola fila dentro: o Steam ha cambiado el
           molde o lo estamos leyendo mal. Lo que no se puede hacer es seguir
           como si nada y acabar diciendo que la lectura fue completa, que es
           justo lo que autoriza a barrer el libro. */
        if (!vistas) {
          complete = false;
          log(`  Esa página no traía ninguna fila; me quedo en ${rows.length}.`);
          break;
        }
        log(`  ${rows.length} filas…`);
        cursor = data.cursor ?? null;
        await sleep(800);
      }
      /* Se acabaron las páginas permitidas y Steam seguía dando cursor: hay más
         historial del que cabe en una pasada. */
      if (cursor && page >= 60) complete = false;
    }

    log(
      `Cartera: ${rows.length} filas leídas${unknown ? `, ${unknown} sin entender` : ""}` +
        `${complete ? "" : " (lectura incompleta)"}.`,
    );
    if (!rows.length) {
      log("Ni una fila. Si estás en el historial y con sesión, avisa: el HTML");
      log("de la tienda habrá cambiado y hay que ajustar el recolector.");
      return;
    }
    offer("Guardar cartera", `reel-steam-cartera-${steamId}.json`, {
      ...base,
      ledger: rows,
      wallet_complete: complete,
    });
    log("Pulsa el botón y súbelo en Reel → Juegos → Steam.");
    return;
  }

  /* ── 1. El inventario ─────────────────────────────────────────────────── */

  /** Junta `assets` con `descriptions` y agrega por nombre de mercado.
   *
   *  Steam devuelve las dos listas por separado y el puente es
   *  `classid_instanceid`: `assets` son las unidades (una fila por objeto que
   *  tienes) y `descriptions` es el catálogo (una por tipo). Lo que se sube es
   *  la agregación por `market_hash_name`, porque esa es la unidad de precio.
   *
   *  Lo que no tiene `market_hash_name` se cae, y tiene que caerse: son los
   *  objetos no vendibles —regalos, cosas de evento, cromos ya usados— que no
   *  cotizan en ningún sitio y que sumados darían un total inventado. */
  async function inventory(app) {
    const out = new Map();
    let start = "";
    let pages = 0;
    for (;;) {
      const url =
        `/inventory/${steamId}/${app.appid}/${app.context}` +
        `?l=spanish&count=2000${start ? `&start_assetid=${start}` : ""}`;
      const data = await get(url);
      const byClass = new Map();
      for (const d of data.descriptions ?? []) {
        byClass.set(`${d.classid}_${d.instanceid}`, d);
      }
      for (const a of data.assets ?? []) {
        const d = byClass.get(`${a.classid}_${a.instanceid}`);
        if (!d?.market_hash_name) continue;
        const key = d.market_hash_name;
        const row = out.get(key) ?? {
          appid: app.appid,
          market_hash_name: key,
          quantity: 0,
          /* El hash pelado, no la URL: el prefijo del CDN lo pone Reel al
             pintar, y así un cambio de CDN de Valve no obliga a re-volcar. */
          icon_url: d.icon_url ?? null,
          item_type: d.type ?? null,
          marketable: Boolean(d.marketable),
        };
        row.quantity += Number(a.amount ?? 1);
        out.set(key, row);
      }
      pages++;
      log(`  ${app.label}: ${out.size} objetos distintos (${pages} página(s))`);
      if (!data.more_items) break;
      start = data.last_assetid;
      /* Entre páginas se respira. Es el endpoint que muerde. */
      await sleep(1500);
    }
    return [...out.values()];
  }

  log("Leyendo tu inventario…");
  const holdings = [];
  for (const app of APPS) {
    try {
      holdings.push(...(await inventory(app)));
    } catch (e) {
      /* Que 753 falle no puede tirar la pasada de 730, que es la que importa.
         Se dice cuál se cayó y se sigue. */
      log(`  ${app.label}: no ha podido ser — ${e.message}`);
    }
    await sleep(1500);
  }
  if (!holdings.length) {
    log("No ha salido ni un objeto vendible. Si tu inventario es privado, está");
    log("en Perfil → Editar perfil → Privacidad → Inventario → Público.");
    return;
  }
  const units = holdings.reduce((n, h) => n + h.quantity, 0);
  log(`Total: ${holdings.length} objetos distintos, ${units} unidades.`);

  /* ── 2. El libro: compras, ventas y cartera ───────────────────────────── */

  /** El historial del mercado, de `market/myhistory/render`.
   *
   *  La respuesta trae `results_html` con las filas, NO datos: hay que parsear.
   *  Cada fila lleva `id="history_row_<listing>_<evento>"`, que es estable, y es
   *  lo que se sube como `external_id` para que re-volcar no duplique nada.
   *
   *  Las dos fechas de la fila son "cuándo se puso" y "cuándo se cerró"; la que
   *  vale es la SEGUNDA. Y el signo lo da el rótulo de la izquierda, que dice
   *  "Vendido"/"Comprado" en tu idioma — así que no se lee el texto, se lee la
   *  clase `market_listing_gainorloss`, que es "+" o "-" en todos.
   *
   *  ── Ese signo habla del OBJETO, no del dinero ──
   *  Y es justo al revés de lo que parece: "+" es un objeto que ENTRA en tu
   *  inventario, o sea una compra, y "-" uno que sale, o sea una venta. Leerlo
   *  como si fuera el dinero cambiaba de bando cada compra y cada venta, y el
   *  realizado salía con el signo cambiado: "he perdido 2.850 € trapicheando"
   *  cuando eran 2.850 € ganados.
   *
   *  Comprobado el 29-08-2026 contra el historial de la cartera, que es la
   *  contabilidad de verdad y sí habla de dinero: las quince filas de "-" de
   *  9,13 € del 7-ago-2026 son en la cartera una sola línea de +136,95 € (15 ×
   *  9,13). Y cuadra el saldo entero de doce años: 304,98 de recargas + 2.850,93
   *  del mercado - 3.108,77 de la tienda - 9,17 de lo demás = 37,97 €, que es el
   *  saldo que enseña Steam hoy. Con el signo al revés no cuadraba nada. */
  /** Qué objeto es cada fila, sacado del bloque `hovers` de la respuesta.
   *
   *  El HTML de la fila no basta para identificar lo que se compró. No trae el
   *  appid por ninguna parte —ni enlace a la ficha, ni atributo, ni dentro de la
   *  URL de la imagen— y el nombre que enseña es el NOMBRE PARA LEER, que en
   *  753 no es el nombre de mercado:
   *
   *      lo que enseña la fila   "City Park"
   *      lo que vale como llave  "639900-City Park"
   *
   *  Y la llave importa porque es la que usan tus objetos y la tabla de precios.
   *  Con el nombre de leer, las 680 compras de cromos y fondos no casaban con
   *  ninguno de los 532 que tienes: cero. Y `costBasis` compara por (appid,
   *  nombre) a propósito, porque un cromo de 753 y una caja de 730 pueden
   *  llamarse igual y valer cosas distintas.
   *
   *  Steam manda las dos cosas al lado del HTML. El bloque `hovers` empareja
   *  cada fila con su objeto:
   *
   *      CreateItemHoverFromContainer( g_rgAssets, 'history_row_A_B_name', 730, '2', '27461336399', 0 );
   *
   *  y `assets[appid][contexto][assetid]` tiene la ficha, `market_hash_name`
   *  incluido. Comprobado el 28-08-2026 contra páginas de verdad: 20 filas, 20
   *  emparejadas, y los 753 saliendo con su prefijo. */
  function assetRefsFromHovers(hovers) {
    const out = new Map();
    const re =
      /CreateItemHoverFromContainer\(\s*g_rgAssets,\s*'(history_row_[^']+?)_(?:name|image)',\s*(\d+),\s*'(\d+)',\s*'(\d+)'/g;
    for (const m of String(hovers || "").matchAll(re)) {
      if (!out.has(m[1])) {
        out.set(m[1], { appid: Number(m[2]), context: m[3], assetid: m[4] });
      }
    }
    return out;
  }

  /** La ficha del objeto de una fila, si viene en el volcado de `assets`. */
  function assetOf(assets, ref) {
    if (!ref || !assets) return null;
    return assets?.[String(ref.appid)]?.[ref.context]?.[ref.assetid] ?? null;
  }

  function parseHistory(html, refs = new Map(), assets = null) {
    const doc = new DOMParser().parseFromString(html, "text/html");
    const rows = [];
    /* Filas que no han encontrado su ficha. Se cuentan porque el respaldo es
       silencioso: si Valve cambia el nombre del ayudante de los hovers o deja
       de mandar `assets`, todo sigue funcionando de cara afuera y las filas
       vuelven a guardarse con el nombre de leer y sin appid — o sea, la avería
       que este arreglo viene a quitar, otra vez y sin que nadie se entere. */
    let sinFicha = 0;
    /* Las filas VISTAS, aparte de las entendidas. Una página entera de "puesto
       a la venta" no trae ni una fila con dinero y no por eso se ha acabado el
       historial: sin esta cuenta, esa página parecería el final. */
    const found = doc.querySelectorAll(".market_listing_row");
    for (const el of found) {
      const id = el.id;
      if (!id) continue;
      const sign = (el.querySelector(".market_listing_gainorloss")?.textContent || "").trim();
      if (sign !== "+" && sign !== "-") continue; // filas de "puesto a la venta", sin dinero
      const amount = cents(el.querySelector(".market_listing_price")?.textContent);
      if (amount === null) continue;
      const dates = [...el.querySelectorAll(".market_listing_listed_date")]
        .map((d) => (d.textContent || "").trim())
        .filter(Boolean);
      const name = (el.querySelector(".market_listing_item_name")?.textContent || "").trim();
      const appEl = el.querySelector(".market_listing_game_name");
      const ref = refs.get(id);
      const asset = assetOf(assets, ref);
      if (!asset) sinFicha += 1;
      rows.push({
        external_id: id,
        /* Sin appid la fila entra igual —el dinero cuenta en el realizado con
           nombre o sin él— pero se queda fuera del coste base, y eso hay que
           poder distinguirlo de "no la hemos guardado". */
        appid: ref?.appid ?? null,
        /* La fecha de Steam es "24 ago" sin año: la reconstruye el servidor
           con el orden de las filas, que llegan de más nueva a más vieja. Aquí
           se sube tal cual y también el índice, que es lo que no se puede
           recuperar después. */
        raw_date: dates[dates.length - 1] ?? null,
        /* "-" es el objeto que se va: eso es una venta. Ver el bloque de
           arriba, que es donde está la comprobación. */
        kind: sign === "-" ? "market_sell" : "market_buy",
        /* Signo desde tu cartera: una venta la llena, una compra la vacía. */
        amount_cents: sign === "-" ? amount : -amount,
        /* El de la ficha manda; el raspado del HTML es el respaldo para cuando
           `assets` no traiga ese objeto. Que sean distintos no es un detalle:
           en 753 son namespaces diferentes y con el equivocado no casa nada. */
        market_hash_name: asset?.market_hash_name || name || null,
        app_name: (appEl?.textContent || "").trim() || null,
      });
    }
    return { rows, seen: found.length, sinFicha };
  }

  log("Leyendo tus compras y ventas…");
  const ledger = [];
  /** Cuántas filas dice Steam que hay, según la PRIMERA respuesta que lo diga.
   *
   *  No se vuelve a mirar, y esa es toda la corrección: estrangulado,
   *  `myhistory` contesta 200 con `total_count` a CERO, y tomar ese cero por el
   *  total nuevo hacía cierto el `start + 100 >= total` de la salida. La lectura
   *  se daba por terminada en la fila 1.800 de 12.026 dejando en el registro un
   *  "1800 de 0…" que no parece un error, y el volcado subía como si estuviera
   *  entero. Medido el 28-08-2026 sobre esta cuenta. */
  let expected = null;
  let ledgerComplete = true;
  /** Filas que se han quedado sin la ficha de `assets`, sumando todas las
   *  páginas. Cero es lo normal; otra cosa hay que decirla. */
  let ledgerUnnamed = 0;
  /** Tope de páginas, que con `expected` a null es el ÚNICO tope que queda.
   *
   *  Sin él, un Steam que devolviera filas sin dar nunca un total creíble deja
   *  el bucle girando para siempre en la pestaña de alguien, a una petición
   *  cada segundo y pico. 300 páginas son 30.000 filas: el triple de la cuenta
   *  más gorda que hemos visto, y aun así un número. */
  const MAX_PAGES = 300;
  for (let start = 0; start < MAX_PAGES * 100; start += 100) {
    let data;
    try {
      data = await get(`/market/myhistory/render/?query=&start=${start}&count=100`);
    } catch (e) {
      ledgerComplete = false;
      log(`  El historial se ha cortado en ${ledger.length} filas — ${e.message}`);
      break;
    }
    const total = Number(data.total_count);
    if (expected === null && Number.isFinite(total) && total > 0) expected = total;
    const { rows, seen, sinFicha } = parseHistory(
      data.results_html || "",
      assetRefsFromHovers(data.hovers),
      data.assets,
    );
    ledgerUnnamed += sinFicha;
    ledger.push(...rows.map((r, i) => ({ ...r, order: start + i })));
    log(`  ${ledger.length} de ${expected ?? "?"}…`);
    /* Una página sin NINGUNA fila dentro es el final de la lista… o Steam que ha
       dejado de contestar. Lo segundo se distingue por el total que dio al
       principio, y se dice: un historial a medias que se presenta como entero
       es un realizado a medias que nadie va a volver a mirar. */
    if (!seen) {
      if (expected !== null && start < expected) {
        ledgerComplete = false;
        log(`  Steam ha dejado de dar filas en la ${start} de ${expected}.`);
      }
      break;
    }
    if (expected !== null && start + 100 >= expected) break;
    /* Se acabaron las páginas permitidas y Steam seguía dando filas: hay más
       historial del que cabe en una pasada, y eso es una lectura incompleta
       como cualquier otra. */
    if (start + 100 >= MAX_PAGES * 100) {
      ledgerComplete = false;
      log(`  Tope de ${MAX_PAGES} páginas: me quedo en ${ledger.length} filas.`);
      break;
    }
    await sleep(1200);
  }
  if (!ledgerComplete) {
    log("  Tus compras y ventas van INCOMPLETAS. Súbelo igual —no borra nada— y");
    log("  vuelve a pasar esto más tarde, cuando Steam deje de estrangular.");
  }
  if (ledgerUnnamed) {
    log(`  ${ledgerUnnamed} filas sin ficha: van con el nombre que se lee y sin`);
    log("  appid, así que no contarán en el coste base. Avisa si sale un número");
    log("  grande: querrá decir que Steam ha movido el bloque de los hovers.");
  }

  /* ── 3. Precios de ahora ──────────────────────────────────────────────── */

  /* Los trae también el cron de Reel a diario, y los del cron son los que
     mandan. Estos son para que la pantalla enseñe algo el primer día en vez de
     una tabla de guiones: Reel solo los acepta para objetos de los que todavía
     no sabe el precio, y los sustituye en cuanto el cron pasa. */
  /** Cuántos fallos SEGUIDOS se aguantan antes de dejar la fase entera.
   *
   *  `priceoverview` se estrangula por su cuenta y a su ritmo: medido el
   *  28-08-2026 en la misma pestaña y el mismo minuto, contestaba 429 a las
   *  tres sondas mientras el inventario, `myhistory` y `pricehistory` iban a
   *  200 — y el mismo extremo desde `curl`, misma máquina y misma IP, a 200
   *  también. Cuando le da por ahí, recorrer los 608 objetos son casi tres
   *  horas fallando uno a uno, cada uno con sus esperas de 2, 4 y 8 segundos, y
   *  el botón de descarga no aparece hasta el final: el inventario y el libro
   *  ya leídos, esperando a que termine de no traer nada.
   *
   *  Rendirse no cuesta nada, y por eso el número es bajo. Estos precios son el
   *  adorno del primer día: los que mandan los trae el cron `steam-prices`
   *  desde un runner —que sí recibe 200— y Reel solo acepta estos para lo que
   *  todavía no conoce. Un fallo suelto no cuenta: la racha se pone a cero en
   *  cuanto uno responde. */
  const GIVE_UP_AFTER = 5;
  let inARow = 0;
  let pricesGaveUp = false;

  log(`Preguntando precios (${holdings.length}; esto es lo que más tarda)…`);
  const prices = [];
  for (let i = 0; i < holdings.length; i++) {
    const h = holdings[i];
    try {
      const p = await get(
        `/market/priceoverview/?appid=${h.appid}&currency=${CURRENCY}` +
          `&market_hash_name=${encodeURIComponent(h.market_hash_name)}`,
        { tries: 3 },
      );
      prices.push({
        appid: h.appid,
        market_hash_name: h.market_hash_name,
        lowest_cents: cents(p.lowest_price),
        median_cents: cents(p.median_price),
        volume: p.volume ? Number(String(p.volume).replace(/[^\d]/g, "")) : null,
      });
      inARow = 0;
    } catch (e) {
      log(`  sin precio: ${h.market_hash_name} (${e.message})`);
      inARow += 1;
      if (inARow >= GIVE_UP_AFTER) {
        pricesGaveUp = true;
        log(`  ${GIVE_UP_AFTER} seguidos sin respuesta: dejo los precios y sigo.`);
        log("  Los pondrá el cron esta madrugada; lo demás no se pierde.");
        break;
      }
    }
    if (i % 25 === 24) log(`  ${i + 1}/${holdings.length}…`);
    /* ~3s por petición. Parece lento y es lo que hace que termine: por debajo
       de eso llega el 429 y entonces sí que se tarda. */
    await sleep(3000);
  }

  /* Por appid Y nombre, no por nombre solo: un cromo de 753 y una caja de 730
     pueden llamarse igual y valen cosas distintas. Es la misma regla que la
     clave de `steamPortfolio`, y aquí se colaba porque este total es solo un
     rótulo — pero un rótulo equivocado en la única cifra que se lee al terminar
     hace dudar de todo lo demás. */
  const qty = new Map(holdings.map((h) => [`${h.appid}:${h.market_hash_name}`, h.quantity]));
  const totalCents = prices.reduce(
    (sum, p) =>
      sum + (p.median_cents ?? 0) * (qty.get(`${p.appid}:${p.market_hash_name}`) ?? 0),
    0,
  );
  /* Con la fase de precios abandonada este total es un trozo del real, y decirlo
     importa: un "0,00 €" a secas después de leer un inventario entero parece
     que lo roto es el inventario. */
  log(
    `Valor ahora mismo: ${(totalCents / 100).toFixed(2)} €` +
      (pricesGaveUp ? ` (solo ${prices.length} de ${holdings.length} precios; falta lo demás)` : ""),
  );

  offer("Guardar inventario", `reel-steam-${steamId}.json`, {
    ...base,
    holdings,
    prices,
    ledger,
  });
  log("");
  log("Listo. Pulsa el botón y sube el fichero en Reel → Juegos → Steam.");

  /* ── 4. El histórico, aparte y opcional ───────────────────────────────── */

  /* En su propio fichero y con su propio botón por dos razones: pesa mucho más
     que todo lo anterior junto, y no hace falta para ver el valor de hoy. Si
     esta parte se cae a medias, lo de arriba ya está descargado. */
  const medians = new Map(
    prices.map((p) => [`${p.appid}:${p.market_hash_name}`, p.median_cents ?? 0]),
  );
  const ordenados = [...holdings]
    .map((h) => ({
      ...h,
      value: (medians.get(`${h.appid}:${h.market_hash_name}`) ?? 0) * h.quantity,
    }))
    .sort((a, b) => b.value - a.value);
  const top = HISTORY_TOP === null ? ordenados : ordenados.slice(0, HISTORY_TOP);

  log("");
  /* Sin un solo precio, esto no empieza. Ya no es porque no se sepa a cuáles
     recortar —desde que se traen todos no hay recorte— sino por lo que significa
     esa lista vacía: Steam acaba de negarse a dar seiscientos precios, que es la
     petición BARATA. Encadenarle seiscientas de histórico, que es la cara, es
     media hora para acabar con las manos igual de vacías.
     Y de paso el orden por valor sale de esas medianas: sin ellas todos valen
     cero, así que cerrar la pestaña a mitad dejaría traído un montón al azar en
     vez de lo que más pesa. */
  if (!prices.length) {
    log("Steam no ha dado ni un precio, así que tampoco dará el histórico: lo dejo.");
    log("Vuelve a pasar esto cuando conteste.");
    return;
  }
  /* Media hora larga, y se dice antes de empezar: es la parte lenta y quien la
     lanza tiene que saber que la pestaña se queda ocupada.
     3,5 y no 3: los tres segundos son la ESPERA entre peticiones, y encima de
     eso está lo que tarda cada una — `pricehistory` devuelve dos años de velas,
     no un precio. Redondear por lo bajo en el único número que alguien va a
     usar para decidir si le da tiempo es la clase de optimismo que sobra. */
  const minutos = Math.round((top.length * 3.5) / 60);
  log(
    `Trayendo el histórico de los ${top.length} objetos — unos ${minutos} minutos…` +
      (pricesGaveUp ? ` (ordenados con los ${prices.length} precios que hay)` : ""),
  );
  log("Puedes dejar la pestaña de fondo; no la cierres.");
  /* La frontera es un DÍA y no un instante, para que las horas de un mismo día
     no se repartan entre el cubo diario y el trimestral: serían dos puntos con
     la misma fecha, y el segundo lo tiraría el upsert de la ingesta. */
  const dailyFrom = new Date(Date.now() - HISTORY_DAILY_DAYS * 864e5)
    .toISOString()
    .slice(0, 10);
  const history = [];
  /* El mismo freno que llevan los precios, y aquí hace más falta que allí.
     `get` reintenta con espera creciente y luego tira, y el `catch` de abajo lo
     apunta y sigue: con sesenta objetos, una negativa sostenida de Steam eran
     diecisiete minutos de pestaña ocupada para acabar sin nada. Con seiscientos
     son casi TRES HORAS, y nadie va a estar delante para pararlo.
     Cinco seguidos sin respuesta no es mala suerte, es que hoy no toca — y lo
     que ya se haya traído se ofrece igual, porque el orden es por valor y lo
     primero es lo que más pesa. */
  const HISTORY_GIVE_UP_AFTER = 5;
  let sinHistorico = 0;
  for (let i = 0; i < top.length; i++) {
    const h = top[i];
    try {
      const p = await get(
        `/market/pricehistory/?country=ES&currency=${CURRENCY}&appid=${h.appid}` +
          `&market_hash_name=${encodeURIComponent(h.market_hash_name)}`,
        { tries: 3 },
      );
      /* Steam da ["Jul 12 2014 01: +0", 1.234, "5"], y el último mes viene POR
         HORA. Se agrega aquí —media ponderada por volumen— porque subir 720
         velas donde caben 30 sesga la curva hacia las horas de más movimiento y
         multiplica por 24 lo que hay que subir.

         El cubo es el día dentro de los dos últimos años y el TRIMESTRE más
         atrás. La media ponderada es la misma cuenta en los dos casos: un
         trimestre es un día muy largo. */
      const byBucket = new Map();
      for (const [when, price, vol] of p.prices ?? []) {
        const t = Date.parse(String(when).replace(/ (\d{2}): \+0$/, " $1:00:00 GMT"));
        if (!Number.isFinite(t)) continue;
        const day = new Date(t).toISOString().slice(0, 10);
        const bucket =
          day >= dailyFrom
            ? day
            : `${day.slice(0, 4)}-Q${Math.ceil(Number(day.slice(5, 7)) / 3)}`;
        const n = Number(vol) || 0;
        const acc = byBucket.get(bucket) ?? { day, cents: 0, vol: 0 };
        /* El punto del trimestre se fecha en su PRIMER día con ventas, no en el
           1 de enero: quien lo lee arrastra el precio hacia adelante hasta el
           punto siguiente —lo hace la gráfica de la ficha y lo hace
           `rpc_steam_value_series`—, y fechar antes de la primera venta sería
           afirmar un precio los días en que no lo hubo. */
        if (day < acc.day) acc.day = day;
        acc.cents += Math.round(price * 100) * Math.max(n, 1);
        acc.vol += Math.max(n, 1);
        byBucket.set(bucket, acc);
      }
      history.push({
        appid: h.appid,
        market_hash_name: h.market_hash_name,
        days: [...byBucket.values()]
          .map((a) => [a.day, Math.round(a.cents / a.vol), a.vol])
          .sort((x, y) => (x[0] < y[0] ? -1 : x[0] > y[0] ? 1 : 0)),
      });
      sinHistorico = 0;
    } catch (e) {
      log(`  sin histórico: ${h.market_hash_name} (${e.message})`);
      sinHistorico += 1;
      if (sinHistorico >= HISTORY_GIVE_UP_AFTER) {
        log(`  ${HISTORY_GIVE_UP_AFTER} seguidos sin respuesta: dejo el histórico aquí.`);
        log("  Lo que ya está traído se puede guardar igual; el resto, otro día.");
        break;
      }
    }
    /* Cada 25 y no cada 10: con seiscientos objetos, uno de cada diez son
       sesenta renglones y el panel se convierte en una cuenta atrás ilegible. */
    if (i % 25 === 24) log(`  ${i + 1}/${top.length}…`);
    await sleep(3000);
  }

  if (history.length) {
    offer("Guardar histórico", `reel-steam-historico-${steamId}.json`, { ...base, history });
    log("Histórico listo — segundo botón, y súbelo también.");
  }
})();
