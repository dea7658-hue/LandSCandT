# 모아 — 다른 컴퓨터에서 이어서 개발하기

여행·맛집·할 일·사진을 친구와 공유하는 모아 소스를 `moa/` 폴더에 추가했습니다. 기존 저장소 프로젝트 파일은 유지했습니다.

## 다운로드

- [모아 소스 ZIP 다운로드](https://github.com/dea7658-hue/LandSCandT/raw/refs/heads/main/downloads/moa-source-latest.zip)
- [소스 폴더](moa/)
- [설정·배포 준비 안내](moa/SETUP.md)

ZIP을 풀면 `moa` 폴더가 나옵니다. Node.js 24 LTS를 설치하고 그 폴더에서:

```bash
npm ci
npm start
```

브라우저: http://localhost:5173

Git으로 전체 저장소를 받았다면 `cd LandSCandT/moa` 후 실행하세요. 저장소 최상위는 기존 다른 프로젝트이므로 모아 실행 명령은 반드시 `moa` 안에서 실행합니다.

## 새 ChatGPT 대화에 붙여넣기

```text
https://github.com/dea7658-hue/LandSCandT 저장소의 main 브랜치 moa/ 폴더에 있는 여행 협업 앱 개발을 이어가 주세요. MOA-START.md, moa/README.md, moa/SETUP.md를 읽고 실제 소스와 실행 상태를 확인하세요. 기존 다른 프로젝트 파일은 보존하세요. 모아는 Svelte 5 + Workers + D1 + 비공개 R2이며, 가입 없이 프로젝트 비밀 코드와 별명으로 참여합니다. 부드러운 연녹색 UI, 지도 중심 시작, 장소·할 일·비공개 사진 공유가 구현되어 있습니다. Google 지도 키 설정과 실제 지도·검색 검증, 운영 배포는 아직 완료되지 않았습니다. .env.local과 로컬 DB·사진은 저장소에 포함되지 않습니다. 구글·네이버 개인 저장 목록 자동 가져오기와 자동 매칭은 아직 구현되지 않았습니다. 기존 기능을 확인하고 필요한 개발을 계속해 주세요.
```

## 설정 정보

지도 키는 `moa/.env.local`에 직접 설정하세요. Cloudflare D1 ID와 R2 버킷은 운영자가 준비해야 합니다. 초대 코드·관리 키·운영 사진·로컬 DB·인증 파일은 이 업로드에 포함하지 않았습니다.

이 업로드는 소스 보관용이며 서비스 운영 배포는 수행하지 않았습니다.
