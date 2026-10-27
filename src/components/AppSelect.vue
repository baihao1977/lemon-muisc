<template>
  <div
    ref="rootRef"
    class="app-select"
    :class="[
      `size-${size}`,
      variant ? `variant-${variant}` : '',
      { open, block, disabled },
    ]"
    :style="minWidth ? { minWidth } : undefined"
  >
    <button
      type="button"
      class="app-select-trigger"
      :title="title"
      :disabled="disabled"
      :aria-expanded="open"
      @click.stop="toggle"
    >
      <span class="app-select-value">{{ currentLabel }}</span>
      <svg class="app-select-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <polyline points="6 9 12 15 18 9"/>
      </svg>
    </button>
    <Teleport to="body">
      <div
        v-if="open"
        ref="menuRef"
        class="app-select-menu"
        :style="menuStyle"
        role="listbox"
        @click.stop
      >
        <button
          v-for="opt in options"
          :key="String(opt.value)"
          type="button"
          class="app-select-option"
          :class="{ active: opt.value === modelValue }"
          role="option"
          :aria-selected="opt.value === modelValue"
          @click="pick(opt.value)"
        >
          {{ opt.label }}
        </button>
      </div>
    </Teleport>
  </div>
</template>

<script setup>
import { ref, computed, watch, nextTick, onMounted, onBeforeUnmount } from 'vue'

const props = defineProps({
  modelValue: { type: [String, Number], default: '' },
  options: { type: Array, default: () => [] },
  title: { type: String, default: '' },
  size: { type: String, default: 'md' },
  variant: { type: String, default: '' },
  block: { type: Boolean, default: false },
  disabled: { type: Boolean, default: false },
  minWidth: { type: String, default: '' },
  /**
   * 菜单 z-index（Teleport 到 body）。
   * 默认高于常见弹窗（创建歌单 11100、确认框 12000、歌词挑选 13000），
   * 否则会看起来像「点了没展开」。
   */
  menuZIndex: { type: [Number, String], default: 14000 },
})

const emit = defineEmits(['update:modelValue', 'change'])

const rootRef = ref(null)
const menuRef = ref(null)
const open = ref(false)
const menuStyle = ref({})
/** 打开当下这一轮 pointer 事件内忽略 outside-close，避免 label 二次激活立刻关掉 */
let ignoreOutsideUntil = 0

const currentLabel = computed(() => {
  const opt = props.options.find(o => o.value === props.modelValue)
  return opt?.label ?? String(props.modelValue ?? '')
})

function resolvedMenuZIndex() {
  return Number(props.menuZIndex) || 14000
}

function updateMenuPosition() {
  const trigger = rootRef.value
  if (!trigger) return
  const rect = trigger.getBoundingClientRect()
  const menuEl = menuRef.value
  const menuWidth = menuEl?.offsetWidth || Math.max(rect.width, 120)
  const maxLeft = Math.max(8, window.innerWidth - menuWidth - 8)
  const left = Math.min(rect.left, maxLeft)
  menuStyle.value = {
    position: 'fixed',
    top: `${rect.bottom + 6}px`,
    left: `${left}px`,
    minWidth: `${rect.width}px`,
    zIndex: resolvedMenuZIndex(),
  }
}

function toggle() {
  if (props.disabled) return
  const next = !open.value
  if (next) ignoreOutsideUntil = Date.now() + 400
  open.value = next
}

function pick(value) {
  if (value !== props.modelValue) {
    emit('update:modelValue', value)
    emit('change', value)
  }
  open.value = false
}

function onDocPointerDown(e) {
  if (!open.value) return
  if (Date.now() < ignoreOutsideUntil) return
  if (rootRef.value?.contains(e.target) || menuRef.value?.contains(e.target)) return
  open.value = false
}

function onKeydown(e) {
  if (e.key === 'Escape') open.value = false
}

watch(open, async (isOpen) => {
  if (!isOpen) return
  await nextTick()
  updateMenuPosition()
  await nextTick()
  updateMenuPosition()
})

onMounted(() => {
  // pointerdown + capture：比 click 更早，且不被 trigger 的 .stop 挡住误关逻辑；
  // 打开瞬间靠 ignoreOutsideUntil 跳过同一轮手势。
  document.addEventListener('pointerdown', onDocPointerDown, true)
  document.addEventListener('keydown', onKeydown)
  window.addEventListener('resize', updateMenuPosition)
  window.addEventListener('scroll', updateMenuPosition, true)
})

onBeforeUnmount(() => {
  document.removeEventListener('pointerdown', onDocPointerDown, true)
  document.removeEventListener('keydown', onKeydown)
  window.removeEventListener('resize', updateMenuPosition)
  window.removeEventListener('scroll', updateMenuPosition, true)
})
</script>
