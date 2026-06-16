#!/bin/bash
# ZOCO FITTING — Script de inicio
# Inicia el servidor local en http://localhost:3000

NODE="/Users/claudia/Library/Caches/ms-playwright-go/1.57.0/node"

echo ""
echo "🚀 Iniciando ZOCO FITTING..."
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# Verificar que Node existe
if [ ! -f "$NODE" ]; then
  echo "❌ Node.js no encontrado en: $NODE"
  echo "   Instala Node.js desde https://nodejs.org"
  exit 1
fi

# Verificar que las dependencias están instaladas
if [ ! -d "node_modules" ]; then
  echo "📦 Instalando dependencias..."
  NPM_CLI="/tmp/package/bin/npm-cli.js"
  if [ -f "$NPM_CLI" ]; then
    $NODE $NPM_CLI install
  else
    echo "❌ npm no encontrado. Instala Node.js completo desde https://nodejs.org"
    exit 1
  fi
fi

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "🌐 Servidor en: http://localhost:3000"
echo "⌨️  Presiona Ctrl+C para detener"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

$NODE server.js
