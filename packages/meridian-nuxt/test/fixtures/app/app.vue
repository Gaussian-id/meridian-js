<script setup lang="ts">
const meridian = useMeridian()
const send = () => meridian.chat.create({ messages: [{ role: 'user', content: 'hi' }] })
</script>

<template>
  <button @click="send">Send</button>
</template>
