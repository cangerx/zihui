<template>
  <svg
    viewBox="0 0 200 140"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    class="w-full h-full"
    aria-hidden="true"
  >
    <!-- 后两张堆叠（仅填充，无描边） -->
    <rect
      x="38" y="18" width="120" height="92" rx="6"
      fill="currentColor" opacity="0.1"
    />
    <rect
      x="30" y="28" width="120" height="92" rx="6"
      fill="currentColor" opacity="0.2"
    />
    <!-- 前画布（描边 + 内容） -->
    <rect
      x="22" y="38" width="120" height="92" rx="6"
      fill="currentColor" opacity="0.06"
    />
    <rect
      x="22" y="38" width="120" height="92" rx="6"
      stroke="currentColor" stroke-width="1.5" opacity="0.55"
    />
    <!-- 内部色块 -->
    <rect
      x="32" y="52" width="44" height="28" rx="3"
      fill="currentColor" opacity="0.35"
    />
    <rect
      x="84" y="52" width="48" height="28" rx="3"
      fill="currentColor" opacity="0.55"
    />
    <rect
      x="32" y="90" width="100" height="28" rx="3"
      fill="currentColor" opacity="0.45"
    />
    <!-- 右下角"叠加"指示线（3 个圆点表示队列） -->
    <g transform="translate(160, 124)" opacity="0.7">
      <circle cx="0" cy="0" r="2.5" fill="currentColor" />
      <circle cx="9" cy="0" r="2.5" fill="currentColor" opacity="0.6" />
      <circle cx="18" cy="0" r="2.5" fill="currentColor" opacity="0.3" />
    </g>
  </svg>
</template>
