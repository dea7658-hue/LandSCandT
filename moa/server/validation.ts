export function safeLink(value: unknown): string {
  if (!value) return "";
  if (typeof value !== "string") throw Error("링크 형식 오류");
  const u = new URL(value);
  const h = u.hostname;
  if (
    u.protocol !== "https:" ||
    !(
      [
        "google.com",
        "www.google.com",
        "maps.google.com",
        "maps.app.goo.gl",
        "goo.gl",
        "naver.me",
        "map.naver.com",
        "m.map.naver.com",
      ].includes(h) || /^maps\.google\.[a-z.]+$/.test(h)
    )
  )
    throw Error("구글지도 또는 네이버지도 HTTPS 링크만 지원합니다.");
  return u.href;
}
export function validateItem(x: any) {
  if (
    !x ||
    typeof x.title !== "string" ||
    !x.title.trim() ||
    x.title.length > 200
  )
    throw Error("제목은 1~200자입니다.");
  if (!["place", "food", "stay", "task"].includes(x.category))
    throw Error("카테고리 오류");
  for (const k of ["address", "note", "assignee", "date"])
    if (typeof x[k] !== "string" || x[k].length > (k === "note" ? 4000 : 300))
      throw Error("항목 형식 오류");
  if (x.date && !/^\d{4}-\d{2}-\d{2}$/.test(x.date))
    throw Error("날짜 형식 오류");
  if (typeof x.done !== "boolean") throw Error("완료 상태 오류");
  for (const [k, max] of [
    ["lat", 90],
    ["lng", 180],
  ] as const)
    if (
      x[k] !== undefined &&
      (typeof x[k] !== "number" ||
        !Number.isFinite(x[k]) ||
        Math.abs(x[k]) > max)
    )
      throw Error("좌표 범위 오류");
  if ((x.lat === undefined) !== (x.lng === undefined))
    throw Error("위도와 경도를 함께 입력해주세요.");
  return {
    lat: x.lat,
    lng: x.lng,
    title: x.title.trim(),
    category: x.category,
    address: x.address,
    note: x.note,
    assignee: x.assignee,
    date: x.date,
    done: x.done,
    url: safeLink(x.url),
  };
}
