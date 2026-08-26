<template>
  <svg
    viewBox="0 0 200 140"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    class="w-full h-full"
    aria-hidden="true"
  >
    <!-- 画布（虚线描边） -->
    <rect
      x="24" y="22" width="130" height="100" rx="8"
      stroke="currentColor" stroke-width="1.5"
      stroke-dasharray="4 3" opacity="0.4"
    />
    <!-- 主色块 -->
    <rect
      x="38" y="40" width="46" height="46" rx="4"
      fill="currentColor" opacity="0.18"
    />
    <!-- 圆 -->
    <circle cx="118" cy="60" r="18" fill="currentColor" opacity="0.4" />
    <!-- 底部条 -->
    <rect
      x="58" y="92" width="78" height="14" rx="3"
      fill="currentColor" opacity="0.6"
    />
    <!-- 右下闪光（生成符号） -->
    <g
      transform="translate(170, 102)"
      stroke="currentColor"
      stroke-width="1.6"
      stroke-linecap="round"
      opacity="0.85"
    >
      <line x1="0" y1="-12" x2="0" y2="12" />
      <line x1="-12" y1="0" x2="12" y2="0" />
      <line x1="-8" y1="-8" x2="8" y2="8" opacity="0.5" />
      <line x1="-8" y1="8" x2="8" y2="-8" opacity="0.5" />
    </g>
  </svg>
</template>
