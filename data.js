"use strict";

/* ============================================================
   2026 월드컵 A조 데이터 (사용자 지정 매치업)
   골키퍼 정보는 Wikipedia / FIFA / 각국 협회 등 사실 확인된
   출처에서 2025-26 시즌 기준으로 조사한 실제 데이터입니다.
   (사진 URL은 Wikimedia Commons 직접 파일, HTTP 200 검증됨)

   ※ 참고: A조 4개국 구성은 사용자가 지정한 시나리오입니다.
     실제 FIFA 공식 조 추첨 결과와는 다를 수 있습니다.
   ============================================================ */

// 사진이 없는(공개 자유이용 이미지 없음) 선수는 photo: null → 이니셜 아바타로 대체
(function () {
const COUNTRIES = [
  {
    code: "KOR",
    name: "대한민국",
    nameEn: "South Korea",
    flag: "🇰🇷",
    colors: { primary: "#c8102e", secondary: "#ffffff", glove: "#e63946" },
    strength: 78, // 시뮬레이션용 전력 (다른 조 경기 결과 산출에 사용)
    keepers: [
      {
        name: "조현우", sub: "Jo Hyeon-woo",
        age: 34, club: "울산 HD", caps: 48, starter: true,
        photo: "https://upload.wikimedia.org/wikipedia/commons/2/26/Jo_Hyeon-woo.jpg",
        note: "2023 아시안컵 영웅 · 2024 K리그1 MVP · 현 주전",
      },
      {
        name: "김승규", sub: "Kim Seung-gyu",
        age: 35, club: "FC 도쿄", caps: 90, starter: false,
        photo: "https://upload.wikimedia.org/wikipedia/commons/8/89/Rus-SK2017_%2822%29.jpg",
        note: "2014·2018·2022 월드컵 경험의 베테랑",
      },
      {
        name: "송범근", sub: "Song Bum-keun",
        age: 28, club: "전북 현대", caps: 3, starter: false,
        photo: "https://upload.wikimedia.org/wikipedia/commons/4/4a/240611_%EB%8C%80%ED%95%9C%EB%AF%BC%EA%B5%AD_vs_%EC%A4%91%EA%B5%AD_%28%EC%86%A1%EB%B2%94%EA%B7%BC%29.jpg",
        note: "장신의 차세대 수문장",
      },
    ],
  },
  {
    code: "MEX",
    name: "멕시코",
    nameEn: "Mexico",
    flag: "🇲🇽",
    colors: { primary: "#006847", secondary: "#ffffff", glove: "#1f9d55" },
    strength: 80,
    keepers: [
      {
        name: "라울 랑헬", sub: "Raúl Rangel",
        age: 26, club: "과달라하라(치바스)", caps: 17, starter: true,
        photo: "https://upload.wikimedia.org/wikipedia/commons/thumb/7/73/Ra%C3%BAl_Rangel.png/250px-Ra%C3%BAl_Rangel.png",
        note: "말라곤 부상 이탈 후 현 주전",
      },
      {
        name: "루이스 말라곤", sub: "Luis Malagón",
        age: 29, club: "클럽 아메리카", caps: 19, starter: false,
        photo: "https://upload.wikimedia.org/wikipedia/commons/thumb/8/88/%C3%81ngel_Malag%C3%B3n_2.png/250px-%C3%81ngel_Malag%C3%B3n_2.png",
        note: "2025 골드컵 골든글러브 (아킬레스건 부상)",
      },
      {
        name: "카를로스 아세베도", sub: "Carlos Acevedo",
        age: 30, club: "산토스 라구나", caps: 7, starter: false,
        photo: "https://upload.wikimedia.org/wikipedia/commons/thumb/3/31/Carlos_Acevedo.png/250px-Carlos_Acevedo.png",
        note: "리가 MX 검증된 백업",
      },
    ],
  },
  {
    code: "CZE",
    name: "체코",
    nameEn: "Czech Republic",
    flag: "🇨🇿",
    colors: { primary: "#11457e", secondary: "#d7141a", glove: "#2b6cb0" },
    strength: 74,
    keepers: [
      {
        name: "마테이 코바르지", sub: "Matěj Kovář",
        age: 26, club: "PSV 에인트호번", caps: 23, starter: true,
        photo: "https://upload.wikimedia.org/wikipedia/commons/thumb/b/bb/Matj_kova-1772635856_%28cropped%29.JPG/250px-Matj_kova-1772635856_%28cropped%29.JPG",
        note: "FIFA 스쿼드 1번 · 현 주전",
      },
      {
        name: "인드르지흐 스타네크", sub: "Jindřich Staněk",
        age: 30, club: "슬라비아 프라하", caps: 14, starter: false,
        photo: "https://upload.wikimedia.org/wikipedia/commons/thumb/f/fd/Jind%C5%99ich_Stan%C4%9Bk_brank%C3%A1%C5%99_FK_Viktorie_Plze%C5%88_%28r._2023%29_%28cropped%29.jpg/250px-Jind%C5%99ich_Stan%C4%9Bk_brank%C3%A1%C5%99_FK_Viktorie_Plze%C5%88_%28r._2023%29_%28cropped%29.jpg",
        note: "오랜 주전 경쟁자",
      },
      {
        name: "루카시 호르니체크", sub: "Lukáš Horníček",
        age: 23, club: "SC 브라가", caps: 1, starter: false,
        photo: null,
        note: "차세대 유망주",
      },
    ],
  },
  {
    code: "RSA",
    name: "남아공",
    nameEn: "South Africa",
    flag: "🇿🇦",
    colors: { primary: "#007a4d", secondary: "#ffb612", glove: "#f0a500" },
    strength: 72,
    keepers: [
      {
        name: "론웬 윌리엄스", sub: "Ronwen Williams",
        age: 34, club: "마멜로디 선다운스", caps: 65, starter: true,
        photo: "https://upload.wikimedia.org/wikipedia/commons/8/89/Ronwen_Williams_AFCON2025Q_35.jpg",
        note: "주장 · 2024 발롱도르 GK 9위 · 부동의 주전",
      },
      {
        name: "리카르도 고스", sub: "Ricardo Goss",
        age: 32, club: "시웰렐레 FC", caps: 5, starter: false,
        photo: null,
        note: "선다운스 임대 백업",
      },
      {
        name: "시포 차이네", sub: "Sipho Chaine",
        age: 29, club: "올랜도 파이러츠", caps: 4, starter: false,
        photo: null,
        note: "프리미어십 검증 백업",
      },
    ],
  },
];

// 코드로 국가 찾기
function getCountry(code) {
  return COUNTRIES.find(c => c.code === code);
}

window.WC = { COUNTRIES, getCountry };
})();
