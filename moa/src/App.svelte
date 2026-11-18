<script lang="ts">
  import { onMount } from "svelte";
  import { get, set as dbSet, del } from "idb-keyval";
  import Papa from "papaparse";
  import { validateItem } from "../server/validation";
  const set = (key: string, value: unknown) =>
    dbSet(key, JSON.parse(JSON.stringify(value)));
  type Item = {
    id: string;
    title: string;
    category: string;
    address: string;
    note: string;
    assignee: string;
    date: string;
    done: boolean;
    url: string;
    version: number;
    deleted?: boolean;
    lat?: number;
    lng?: number;
  };
  type Session = {
    project: { id: string; name: string };
    token: string;
    nickname: string;
    code?: string;
    admin?: string;
  };
  let session = $state<Session | null>(null),
    items = $state<Item[]>([]),
    pending = $state<Record<string, Item>>({}),
    cursor = 0;
  let syncing = false;
  let name = $state("우리의 다음 여행"),
    nickname = $state(""),
    joinCode = $state(""),
    join = $state(false),
    message = $state(""),
    busy = $state(false),
    ready = $state(false),
    view = $state("map"),
    filter = $state("all");
  let editor = $state<Item | null>(null),
    sharing = $state(false),
    mapEl = $state<HTMLDivElement>(),
    map: any,
    markers: any[] = [];
  let mapState = $state(""),
    query = $state(""),
    candidates = $state<any[]>([]),
    selected = $state<Item | null>(null),
    photos = $state<any[]>([]),
    photoURLs: string[] = [],
    photoBusy = $state(false);
  const categories: Record<string, string> = {
    place: "산책 · 여행",
    food: "맛집 · 카페",
    stay: "숙소",
    task: "할 일",
  };
  const icons: Record<string, string> = {
    place: "✦",
    food: "☕",
    stay: "⌂",
    task: "✓",
  };
  const visible = $derived(
    items.filter(
      (i) => !i.deleted && (filter === "all" || i.category === filter),
    ),
  );
  const done = $derived(items.filter((i) => !i.deleted && i.done).length);
  const cacheKey = () => `project:${session!.project.id}`;
  async function persist() {
    if (session) await set(cacheKey(), { items, pending, cursor });
  }
  async function api(path: string, method = "GET", body?: unknown) {
    const r = await fetch("/api" + path, {
      method,
      headers: {
        ...(body ? { "Content-Type": "application/json" } : {}),
        ...(session ? { Authorization: "Bearer " + session.token } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const x = await r.json();
    if (!r.ok)
      throw Object.assign(new Error(x.error || "요청 실패"), {
        status: r.status,
      });
    return x;
  }
  async function enter(create: boolean) {
    busy = true;
    message = "";
    try {
      const x = await api(
        create ? "/create" : "/join",
        "POST",
        create ? { name, nickname } : { code: joinCode, nickname },
      );
      session = x;
      await set("session", x);
      items = [];
      pending = {};
      cursor = 0;
      const saved: any = await get(cacheKey());
      if (saved) {
        items = saved.items;
        pending = saved.pending;
        cursor = saved.cursor;
      }
      sharing = create;
      await sync();
    } catch (e) {
      message = (e as Error).message;
    } finally {
      busy = false;
    }
  }
  async function sync() {
    if (!session || syncing) return;
    syncing = true;
    try {
      for (const [id, item] of Object.entries(pending)) {
        try {
          const x = await api("/items/" + id, "PUT", {
            item,
            version: item.version,
            deleted: !!item.deleted,
          });
          items = items.map((i) =>
            i.id === id ? { ...i, version: x.version } : i,
          );
          const next = { ...pending };
          if (JSON.stringify(next[id]) === JSON.stringify(item))
            delete next[id];
          else if (next[id]) next[id] = { ...next[id], version: x.version };
          pending = next;
          await persist();
        } catch (e) {
          if ((e as any).status === 409) {
            message =
              "수정 충돌이 있어요. 내 변경을 백업하거나 취소한 뒤 다시 수정해주세요.";
            await persist();
            return;
          }
          throw e;
        }
      }
      let more = true;
      while (more) {
        const x = await api("/items?since=" + cursor);
        const merged = new Map(items.map((i) => [i.id, i]));
        for (const item of x.items)
          if (!pending[item.id]) merged.set(item.id, item);
        items = [...merged.values()];
        cursor = x.cursor;
        more = x.more;
      }
      await persist();
      paint();
    } catch (e) {
      message = navigator.onLine
        ? (e as Error).message
        : "오프라인이에요. 변경을 기기에 보관했어요.";
    } finally {
      syncing = false;
    }
  }
  function modalFocus(node: HTMLElement) {
    const prev = document.activeElement as HTMLElement;
    const focusable = () =>
      Array.from(
        node.querySelectorAll<HTMLElement>(
          "button:not([disabled]),input:not([disabled]),textarea,select,a[href]",
        ),
      ).filter((e) => e.offsetParent !== null);
    queueMicrotask(() => focusable()[0]?.focus());
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        editor = null;
        selected = null;
        sharing = false;
      }
      if (e.key === "Tab") {
        const all = focusable(),
          first = all[0],
          last = all.at(-1);
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last?.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first?.focus();
        }
      }
    };
    node.addEventListener("keydown", key);
    return {
      destroy() {
        node.removeEventListener("keydown", key);
        prev?.focus();
      },
    };
  }
  function blank(): Item {
    return {
      id: crypto.randomUUID(),
      title: "",
      category: "place",
      address: "",
      note: "",
      assignee: "",
      date: "",
      done: false,
      url: "",
      version: 0,
    };
  }
  async function save(item: Item) {
    try {
      validateItem(item);
    } catch (e) {
      message = (e as Error).message;
      return;
    }
    const old = items.find((i) => i.id === item.id);
    const next = { ...item, version: old?.version || 0 };
    items = [...items.filter((i) => i.id !== next.id), next];
    pending = { ...pending, [next.id]: next };
    await persist();
    editor = null;
    paint();
    await sync();
  }
  async function remove(item: Item) {
    if (confirm("이 항목을 삭제할까요? 사진도 더 이상 열 수 없어요."))
      await save({ ...item, deleted: true });
  }
  async function discard() {
    if (
      confirm("전송되지 않은 변경을 취소할까요? 먼저 JSON 백업을 권장해요.")
    ) {
      items = items.filter((i) => !pending[i.id]);
      pending = {};
      cursor = 0;
      await persist();
      await sync();
    }
  }
  function backup() {
    const blob = new Blob(
      [
        JSON.stringify(
          {
            format: "moa-v1",
            name: session?.project.name,
            items: items.filter((i) => !i.deleted),
          },
          null,
          2,
        ),
      ],
      { type: "application/json" },
    );
    download(blob, "moa-backup.json");
  }
  function download(blob: Blob, file: string) {
    const u = URL.createObjectURL(blob),
      a = document.createElement("a");
    a.href = u;
    a.download = file;
    a.click();
    setTimeout(() => URL.revokeObjectURL(u), 1000);
  }
  async function importFile(event: Event) {
    const input = event.target as HTMLInputElement,
      file = input.files?.[0];
    if (!file) return;
    try {
      if (file.size > 2000000) throw Error("2MB 이하 파일만 가져올 수 있어요.");
      let rows: any[];
      if (file.name.endsWith(".json")) {
        const x = JSON.parse(await file.text());
        rows = Array.isArray(x) ? x : x.items;
      } else {
        const result = Papa.parse(await file.text(), {
          header: true,
          skipEmptyLines: true,
        });
        if (result.errors.length) throw Error("CSV 형식을 확인해주세요.");
        rows = result.data;
      }
      if (!Array.isArray(rows) || rows.length > 200)
        throw Error("한 번에 최대 200개까지 가능해요.");
      if (
        !confirm(
          `${rows.length}개 항목을 새 항목으로 가져올까요? 중복은 직접 확인해주세요.`,
        )
      )
        return;
      const imported: Item[] = [];
      for (const row of rows) {
        const item = {
          ...blank(),
          title: String(row.title || row.name || "").slice(0, 200),
          address: String(row.address || ""),
          note: String(row.note || ""),
          category: categories[row.category] ? row.category : "place",
          url: String(row.url || ""),
          date: String(row.date || ""),
          done: row.done === true || row.done === "true",
          ...(typeof row.lat === "number" && typeof row.lng === "number"
            ? { lat: row.lat, lng: row.lng }
            : {}),
        };
        if (item.title) {
          validateItem(item);
          imported.push(item);
        }
      }
      for (const item of imported) {
        items = [...items, item];
        pending = { ...pending, [item.id]: item };
      }
      await persist();
      await sync();
    } catch (e) {
      message = (e as Error).message;
    }
    input.value = "";
  }
  async function loadMap() {
    if (map || !mapEl) return;
    const key = import.meta.env.VITE_GOOGLE_MAPS_API_KEY;
    if (!key) {
      mapState = "Google Maps API 키를 설정하면 이곳에 세계 지도가 열려요.";
      return;
    }
    mapState = "지도를 불러오고 있어요…";
    try {
      const g = window as any;
      if (!g.google?.maps) {
        await new Promise<void>((resolve, reject) => {
          const s = document.createElement("script");
          s.src =
            "https://maps.googleapis.com/maps/api/js?key=" +
            encodeURIComponent(key) +
            "&libraries=places&loading=async&callback=__moaMapReady";
          g.__moaMapReady = () => { delete g.__moaMapReady; resolve(); };
          s.onerror = () => reject(Error("지도를 불러오지 못했어요."));
          document.head.appendChild(s);
        });
      }
      map = new g.google.maps.Map(mapEl, {
        center: { lat: 37.5665, lng: 126.978 },
        zoom: 12,
        mapTypeControl: false,
        streetViewControl: false,
        fullscreenControl: false,
        clickableIcons: false,
      });
      map.addListener("click", (e: any) => {
        editor = { ...blank(), lat: e.latLng.lat(), lng: e.latLng.lng() };
      });
      paint(true);
      mapState = "";
    } catch (e) {
      mapState = (e as Error).message;
    }
  }
  function paint(fit = false) {
    if (!map) return;
    const g = (window as any).google;
    for (const m of markers) m.setMap(null);
    markers = [];
    const bounds = new g.maps.LatLngBounds();
    for (const i of visible) {
      if (typeof i.lat !== "number" || typeof i.lng !== "number") continue;
      const m = new g.maps.Marker({
        map,
        position: { lat: i.lat, lng: i.lng },
        title: i.title,
        label: icons[i.category],
      });
      m.addListener("click", () => openDetail(i));
      markers.push(m);
      bounds.extend(m.getPosition());
    }
    if (fit && markers.length) {
      map.fitBounds(bounds);
      if (markers.length === 1) map.setZoom(14);
    }
  }
  async function search() {
    if (!query.trim()) return;
    if (!map) {
      message =
        "지도 API 키를 설정한 뒤 검색해주세요. 직접 장소를 추가할 수도 있어요.";
      return;
    }
    try {
      const { Place } = await (window as any).google.maps.importLibrary(
        "places",
      );
      const result = await Place.searchByText({
        textQuery: query,
        fields: ["id", "displayName", "formattedAddress", "location"],
        maxResultCount: 5,
      });
      candidates = result.places;
    } catch {
      message =
        "장소 검색을 사용할 수 없어요. Places API (New) 설정을 확인해주세요.";
    }
  }
  function choose(p: any) {
    editor = {
      ...blank(),
      title: p.displayName,
      address: p.formattedAddress || "",
      lat: p.location.lat(),
      lng: p.location.lng(),
      url:
        "https://www.google.com/maps/search/?api=1&query=" +
        encodeURIComponent(p.displayName) +
        "&query_place_id=" +
        encodeURIComponent(p.id),
    };
    candidates = [];
  }
  async function openDetail(item: Item) {
    selected = item;
    photos = [];
    for (const url of photoURLs) URL.revokeObjectURL(url);
    photoURLs = [];
    try {
      photos = (await api("/photos?item=" + item.id)).photos;
    } catch (e) {
      message = (e as Error).message;
    }
  }
  async function loadPhoto(photo: any) {
    try {
      const r = await fetch("/api/photos/" + photo.id, {
        headers: { Authorization: "Bearer " + session!.token },
      });
      if (!r.ok) throw Error("사진을 불러오지 못했어요.");
      const u = URL.createObjectURL(await r.blob());
      photoURLs.push(u);
      photos = photos.map((p) => (p.id === photo.id ? { ...p, src: u } : p));
    } catch (e) {
      message = (e as Error).message;
    }
  }
  async function compress(file: File): Promise<Blob> {
    if (
      !["image/jpeg", "image/png", "image/webp"].includes(file.type) ||
      file.size > 20000000
    )
      throw Error("20MB 이하 JPG·PNG·WebP 사진을 선택해주세요.");
    const img = await createImageBitmap(file);
    const ratio = Math.min(1, 1600 / Math.max(img.width, img.height)),
      canvas = document.createElement("canvas");
    canvas.width = Math.round(img.width * ratio);
    canvas.height = Math.round(img.height * ratio);
    canvas.getContext("2d")!.drawImage(img, 0, 0, canvas.width, canvas.height);
    img.close();
    const blob = await new Promise<Blob | null>((r) =>
      canvas.toBlob(r, "image/webp", 0.78),
    );
    if (!blob || blob.size > 2000000)
      throw Error("사진 용량을 줄이지 못했어요. 더 작은 사진을 선택해주세요.");
    return blob;
  }
  async function upload(event: Event) {
    const input = event.target as HTMLInputElement,
      file = input.files?.[0];
    if (!file || !selected) return;
    photoBusy = true;
    try {
      if (pending[selected.id]) {
        await sync();
        if (pending[selected.id]) throw Error("장소를 먼저 동기화해주세요.");
      }
      const blob = await compress(file);
      const r = await fetch("/api/photos?item=" + selected.id, {
        method: "POST",
        headers: {
          Authorization: "Bearer " + session!.token,
          "Content-Type": "image/webp",
        },
        body: blob,
      });
      const x = await r.json();
      if (!r.ok) throw Error(x.error);
      await openDetail(selected);
      message = "사진을 저장했어요. 프로젝트 친구들이 함께 볼 수 있어요.";
    } catch (e) {
      message = (e as Error).message;
    } finally {
      photoBusy = false;
      input.value = "";
    }
  }
  async function deletePhoto(id: string) {
    if (!confirm("사진을 삭제할까요?")) return;
    try {
      await api("/photos/" + id, "DELETE");
      if (selected) await openDetail(selected);
    } catch (e) {
      message = (e as Error).message;
    }
  }
  async function admin(action: string) {
    const key = session?.admin || prompt("프로젝트 관리 키를 입력해주세요.");
    if (!key) return;
    if (
      !confirm(
        action === "delete"
          ? "프로젝트와 사진을 모두 삭제할까요?"
          : "코드를 바꾸면 다른 친구들은 새 코드로 다시 참여해야 해요. 계속할까요?",
      )
    )
      return;
    try {
      const x = await api("/admin", "POST", { admin: key, action });
      if (action === "rotate") {
        session = { ...session!, code: x.code };
        await set("session", session);
      } else await leave();
    } catch (e) {
      message = (e as Error).message;
    }
  }
  async function leave() {
    await del("session");
    session = null;
    map = null;
    items = [];
    pending = {};
    selected = null;
    sharing = false;
  }
  onMount(() => {
    let timer: ReturnType<typeof setInterval>;
    const resume = () => {
      if (!document.hidden) sync();
    };
    (async () => {
      session = (await get("session")) || null;
      if (session) {
        const saved: any = await get(cacheKey());
        if (saved) {
          items = saved.items;
          pending = saved.pending;
          cursor = saved.cursor;
        }
      }
      ready = true;
      await sync();
    })();
    timer = setInterval(resume, 60000);
    window.addEventListener("online", resume);
    document.addEventListener("visibilitychange", resume);
    return () => {
      clearInterval(timer);
      window.removeEventListener("online", resume);
      document.removeEventListener("visibilitychange", resume);
      for (const u of photoURLs) URL.revokeObjectURL(u);
    };
  });
  $effect(() => {
    if (session && view === "map") {
      queueMicrotask(() => loadMap());
    }
  });
  $effect(() => {
    filter;
    items;
    if (map) paint();
  });
</script>

<svelte:head
  ><meta
    name="description"
    content="친구와 함께, 장소와 할 일을 가볍게. 가입 없이 코드로 시작하는 여행 지도."
  /></svelte:head
>
{#if !ready}<main class="welcome">
    <h1>모아<span>✦</span></h1>
    <p>우리의 여행을 펼치는 중…</p>
  </main>
{:else if !session}
  <main class="landing">
    <div class="brand">
      모아 <span>✦</span><small>작은 계획, 함께 쌓이는 추억</small>
    </div>
    <div class="landing-grid">
      <section>
        <div class="eyebrow">OUR LITTLE WORLD</div>
        <h1>가고 싶은 곳도,<br />함께한 순간도.<span> 한곳에 모아.</span></h1>
        <p class="intro">
          지도에 마음에 드는 곳을 담고,<br />친구와 다음 여행을 만들어 보세요.
        </p>
        <div class="illustration">
          <span class="route">· · · · · · · · · ·</span>
          <div class="pin p1">☕<small>다음엔 여기!</small></div>
          <div class="pin p2">✦<small>우리의 추억</small></div>
          <div class="pin p3">⌂</div>
        </div>
        <p class="muted">가입 없이 · 비밀 코드로 함께 · 사진은 우리끼리</p>
      </section>
      <section class="entry card">
        <div class="tabs">
          <button class:active={!join} onclick={() => (join = false)}
            >새 여행 만들기</button
          ><button class:active={join} onclick={() => (join = true)}
            >코드로 참여</button
          >
        </div>
        <h2>{join ? "친구들이 기다리고 있어요" : "어디로 떠나볼까요?"}</h2>
        <p class="muted">
          {join
            ? "친구에게 받은 비밀 코드를 입력해주세요."
            : "여행, 동네 맛집, 주말 계획. 무엇이든 좋아요."}
        </p>
        <form
          onsubmit={(e) => {
            e.preventDefault();
            enter(!join);
          }}
        >
          <label
            >나를 부를 이름<input
              bind:value={nickname}
              maxlength="30"
              placeholder="예: 여행하는 수진"
              required
            /></label
          >{#if join}<label
              >프로젝트 비밀 코드<input
                bind:value={joinCode}
                placeholder="친구에게 받은 코드"
                required
                autocomplete="off"
              /></label
            >{:else}<label
              >프로젝트 이름<input
                bind:value={name}
                maxlength="100"
                required
              /></label
            >{/if}<button class="primary wide" disabled={busy}
            >{busy
              ? "준비하고 있어요…"
              : join
                ? "함께하기 →"
                : "우리 지도 펼치기 →"}</button
          >
        </form>
        <p class="tiny">
          코드는 초대장과 같아요. 함께할 친구에게만 전해주세요.
        </p>
      </section>
    </div>
  </main>
{:else}
  <div class="app">
    <aside class="rail">
      <a class="brand" href="/">모아<span>✦</span></a><button
        class:chosen={view === "map"}
        onclick={() => (view = "map")}>⌖<span>지도</span></button
      ><button class:chosen={view === "list"} onclick={() => (view = "list")}
        >☷<span>목록</span></button
      ><button onclick={() => (sharing = true)}>♧<span>함께</span></button>
      <div class="rail-bottom">{session.nickname.slice(0, 1) || "나"}</div>
    </aside>
    <main class="workspace">
      <header>
        <div>
          <div class="eyebrow">OUR SHARED JOURNEY</div>
          <h1>{session.project.name}<span class="small-star">✦</span></h1>
          <p>함께 고르고, 가볍게 떠나요.</p>
        </div>
        <button class="outline" onclick={() => (sharing = true)}
          >친구 초대 ↗</button
        >
      </header>
      <div class="toolbar">
        <div class="chips">
          <button
            class:active={filter === "all"}
            onclick={() => (filter = "all")}>모든 장소</button
          >{#each Object.entries(categories) as [key, label]}<button
              class:active={filter === key}
              onclick={() => (filter = key)}>{icons[key]} {label}</button
            >{/each}
        </div>
        <button class="primary" onclick={() => (editor = blank())}
          >＋ 추가하기</button
        >
      </div>
      <div class="content" class:list-mode={view === "list"}>
        <section class="places">
          <div class="section-heading">
            <h2>우리의 리스트 <span>{visible.length}</span></h2>
            <button
              class="text"
              onclick={() => {
                message = "";
                sync();
              }}>↻ 새로고침</button
            >
          </div>
          <div class="progress">
            <span>작은 계획이 추억이 되는 중</span><b>{done}곳 완료</b>
          </div>
          {#if !visible.length}<div class="empty">
              <span>✦</span>
              <h3>첫 번째 장소를 담아볼까요?</h3>
              <p>
                지도에서 검색하거나, 원하는 위치를 눌러<br />우리의 리스트를
                시작해보세요.
              </p>
              <button class="outline" onclick={() => (editor = blank())}
                >첫 장소 추가</button
              >
            </div>{/if}{#each visible as item (item.id)}<article
              class="place-card"
            >
              <div class="place-top">
                <span
                  class="category-icon"
                  class:food={item.category === "food"}
                  >{icons[item.category]}</span
                >
                <div>
                  <small>{categories[item.category]}</small><button
                    class="title-button"
                    onclick={() => openDetail(item)}>{item.title}</button
                  >
                </div>
                <input
                  class="check"
                  type="checkbox"
                  checked={item.done}
                  aria-label={item.title + " 완료"}
                  onchange={() => save({ ...item, done: !item.done })}
                />
              </div>
              {#if item.address}<p class="address">
                  ⌖ {item.address}
                </p>{/if}{#if item.note}<p class="note">{item.note}</p>{/if}
              <div class="card-footer">
                <span
                  >{item.date || "날짜는 천천히"}{item.assignee
                    ? " · " + item.assignee
                    : ""}</span
                ><button class="text" onclick={() => openDetail(item)}
                  >사진 · 자세히 ↗</button
                >
              </div>
            </article>{/each}
          <div class="list-tools">
            <button class="text" onclick={backup}>↓ JSON 백업</button><label
              class="text file-label"
              >↑ CSV / JSON 가져오기<input
                type="file"
                accept=".csv,.json"
                onchange={importFile}
              /></label
            >
          </div>
          {#if Object.keys(pending).length}<p class="tiny">
              전송 대기 {Object.keys(pending).length}개 · 기기에 보관 중
            </p>
            <button class="text" onclick={discard}>대기 변경 취소</button>{/if}
        </section>
        <section class="map-panel" class:hidden={view !== "map"}>
          <div class="map" bind:this={mapEl}></div>
          <form
            class="map-search"
            onsubmit={(e) => {
              e.preventDefault();
              search();
            }}
          >
            <span>⌕</span><input
              bind:value={query}
              placeholder="전 세계, 가고 싶은 곳을 검색"
              aria-label="장소 검색"
            /><button class="primary">검색</button>
          </form>
          {#if candidates.length}<div class="search-results">
              {#each candidates as p}<button onclick={() => choose(p)}
                  ><b>{p.displayName}</b><small>{p.formattedAddress}</small
                  ></button
                >{/each}
            </div>{/if}{#if mapState}<div class="map-placeholder">
              <div class="decor-pin">⌖</div>
              <h2>우리의 다음 목적지는?</h2>
              <p>{mapState}</p>
              <button class="outline" onclick={() => (editor = blank())}
                >장소 직접 담기</button
              >
            </div>{/if}
          <div class="map-hint">
            ✦ 지도를 누르면 그 위치에 장소를 담을 수 있어요
          </div>
          <button class="data-mode" onclick={() => (view = "list")}
            >☷ 저데이터 목록 모드</button
          >
        </section>
      </div>
    </main>
  </div>
{/if}
{#if message}<div class="toast" role="status">
    <span>{message}</span><button
      onclick={() => (message = "")}
      aria-label="알림 닫기">×</button
    >
  </div>{/if}
{#if editor}<div class="overlay">
    <div
      class="modal"
      use:modalFocus
      role="dialog"
      aria-modal="true"
      aria-label="장소 편집"
      tabindex="-1"
    >
      <button class="close" onclick={() => (editor = null)} aria-label="닫기"
        >×</button
      >
      <div class="eyebrow">A LITTLE PLAN</div>
      <h2>{editor.version ? "계획 다듬기" : "새로운 설렘 담기"} ✦</h2>
      <form
        onsubmit={(e) => {
          e.preventDefault();
          save(editor!);
        }}
      >
        <label
          >장소 또는 할 일<input
            bind:value={editor.title}
            required
            maxlength="200"
            placeholder="예: 함께 가보고 싶은 작은 카페"
          /></label
        >
        <div class="form-row">
          <label
            >종류<select bind:value={editor.category}
              >{#each Object.entries(categories) as [k, v]}<option value={k}
                  >{v}</option
                >{/each}</select
            ></label
          ><label>날짜<input type="date" bind:value={editor.date} /></label>
        </div>
        <label>주소<input bind:value={editor.address} maxlength="300" /></label>
        <div class="form-row">
          <label
            >위도<input
              type="number"
              step="any"
              min="-90"
              max="90"
              bind:value={editor.lat}
            /></label
          ><label
            >경도<input
              type="number"
              step="any"
              min="-180"
              max="180"
              bind:value={editor.lng}
            /></label
          >
        </div>
        <label
          >구글지도 / 네이버지도 링크<input
            type="url"
            bind:value={editor.url}
            placeholder="https://…"
          /></label
        ><label
          >담당 친구<input
            bind:value={editor.assignee}
            maxlength="300"
          /></label
        ><label
          >우리만의 메모<textarea
            bind:value={editor.note}
            maxlength="4000"
            placeholder="예약 팁, 먹고 싶은 메뉴, 함께 하고 싶은 일…"
          ></textarea></label
        ><button class="primary wide">리스트에 담기</button>
      </form>
    </div>
  </div>{/if}
{#if selected}<div class="overlay">
    <div
      class="modal"
      use:modalFocus
      role="dialog"
      aria-modal="true"
      aria-label="장소와 사진"
      tabindex="-1"
    >
      <button
        class="close"
        onclick={() => {
          selected = null;
          photos = [];
        }}
        aria-label="닫기">×</button
      >
      <div class="eyebrow">OUR LITTLE MEMORY</div>
      <h2>{selected.title}</h2>
      <p>{selected.address}</p>
      <p class="detail-note">{selected.note}</p>
      {#if selected.url}<a
          href={selected.url}
          target="_blank"
          rel="noopener noreferrer">원본 지도에서 열기 ↗</a
        >{/if}
      <div class="section-heading">
        <h3>함께한 순간들</h3>
        <label class="outline file-label"
          >{photoBusy ? "사진 줄이는 중…" : "＋ 사진 담기"}<input
            type="file"
            accept="image/jpeg,image/png,image/webp"
            disabled={photoBusy}
            onchange={upload}
          /></label
        >
      </div>
      <p class="tiny">
        프로젝트 친구들만 볼 수 있어요. 최대 1600px로 줄여 저장하며, 사진은
        눌러야 내려받아요.
      </p>
      <div class="photo-grid">
        {#each photos as photo}<div>
            {#if photo.src}<img
                src={photo.src}
                alt="프로젝트에 공유한 여행 사진"
              />{:else}<button
                class="photo-placeholder"
                onclick={() => loadPhoto(photo)}
                >▧<span>사진 보기</span><small
                  >{Math.round(photo.size / 1024)} KB</small
                ></button
              >{/if}
            <div class="card-footer">
              <small>{photo.nickname}</small><button
                class="text"
                onclick={() => deletePhoto(photo.id)}>삭제</button
              >
            </div>
          </div>{/each}
      </div>
      {#if !photos.length}<p class="empty">여기에 첫 추억을 남겨보세요.</p>{/if}
      <div class="modal-actions">
        <button
          class="outline"
          onclick={() => {
            editor = { ...selected! };
            selected = null;
          }}>수정하기</button
        ><button
          class="text danger"
          onclick={() => {
            remove(selected!);
            selected = null;
          }}>항목 삭제</button
        >
      </div>
    </div>
  </div>{/if}
{#if sharing && session}<div class="overlay">
    <div
      class="modal"
      use:modalFocus
      role="dialog"
      aria-modal="true"
      aria-label="프로젝트 공유"
      tabindex="-1"
    >
      <button class="close" onclick={() => (sharing = false)} aria-label="닫기"
        >×</button
      >
      <div class="eyebrow">BETTER TOGETHER</div>
      <h2>우리만의 초대장 ♧</h2>
      <p>같은 웹사이트에서 아래 코드를 입력하면 함께할 수 있어요.</p>
      <label
        >참여 코드<input
          readonly
          value={session.code || "코드를 입력하고 입장했어요"}
        /></label
      >{#if session.code}<button
          class="primary wide"
          onclick={async () => {
            try {
              await navigator.clipboard.writeText(session!.code!);
              message = "초대 코드를 복사했어요.";
            } catch {
              message = "코드를 선택해서 복사해주세요.";
            }
          }}>코드 복사</button
        >{/if}{#if session.admin}<label
          >관리 키 · 안전한 곳에 따로 보관해주세요<input
            readonly
            value={session.admin}
          /></label
        >
        <p class="tiny">
          기기를 잃어버리면 키를 복구할 수 없어요. 키와 코드를 아는 사람은
          프로젝트에 접근할 수 있어요.
        </p>
        <button
          class="outline"
          onclick={() =>
            download(
              new Blob(
                [
                  JSON.stringify(
                    {
                      project: session!.project,
                      code: session!.code,
                      admin: session!.admin,
                    },
                    null,
                    2,
                  ),
                ],
                { type: "application/json" },
              ),
              "moa-project-keys.json",
            )}>관리 키 파일 저장</button
        >{/if}
      <div class="modal-actions">
        <button class="text" onclick={() => admin("rotate")}
          >초대 코드 재발급</button
        ><button class="text danger" onclick={() => admin("delete")}
          >프로젝트 삭제</button
        >
      </div>
      <button class="outline wide" onclick={leave}>이 기기에서 나가기</button>
      <p class="tiny">
        서버의 프로젝트는 유지됩니다. 이 기기에 저장된 오프라인 사본을 지우려면
        브라우저 사이트 데이터를 삭제해주세요.
      </p>
    </div>
  </div>{/if}
