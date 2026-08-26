<template>
  <svg
    viewBox="0 0 200 140"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    class="w-full h-full"
    aria-hidden="true"
  >
    <!-- 画布（实线） -->
    <rect
      x="22" y="22" width="124" height="96" rx="8"
      stroke="currentColor" stroke-width="1.5" opacity="0.55"
    />
    <!-- 主色块 -->
    <rect
      x="34" y="36" width="64" height="42" rx="4"
      fill="currentColor" opacity="0.22"
    />
    <!-- 圆 -->
    <circle cx="120" cy="56" r="12" fill="currentColor" opacity="0.45" />
    <!-- 底部裁切线 -->
    <line
      x1="34" y1="98" x2="134" y2="98"
      stroke="currentColor" stroke-width="1.5"
      stroke-dasharray="3 3" opacity="0.4"
    />
    <!-- 笔（斜伸出画布右下） -->
    <g transform="translate(126, 80) rotate(38)" opacity="0.9">
      <!-- 笔身 -->
      <rect
        x="0" y="-5" width="50" height="10" rx="2"
        fill="currentColor" opacity="0.65"
      />
      <!-- 笔尖三角 -->
      <path
        d="M 0 -5 L -10 0 L 0 5 Z"
        fill="currentColor" opacity="0.85"
      />
      <!-- 笔尾分隔线 -->
      <line
        x1="38" y1="-5" x2="38" y2="5"
        stroke="currentColor" stroke-width="1.2" opacity="0.4"
      />
    </g>
  </svg>
</template>
