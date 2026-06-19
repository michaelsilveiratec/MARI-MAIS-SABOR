@echo off
cd /d "%~dp0"
title Mari Mais Sabor - Agente de Impressao
echo Iniciando o agente da impressora POS-80...
echo Mantenha esta janela aberta durante o atendimento.
echo.
npm run print-agent
echo.
echo O agente foi encerrado ou encontrou um erro.
pause
