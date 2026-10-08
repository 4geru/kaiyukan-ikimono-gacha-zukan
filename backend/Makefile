PROJECT := kaiyukan-gacha-hackathon
REGION := asia-northeast1
SERVICE := kaiyukan-gacha-bot
BUCKET_IMAGES := kaiyukan-gacha-hackathon-images
# LIFF(ミニアプリ)のIDトークン検証で許可するチャネルID（Developing / Published）と、/auth/line のCORS許可オリジン
LINE_LOGIN_CHANNEL_IDS := 2011666396,2011666398
AUTH_ALLOWED_ORIGINS := https://kaiyukan-gacha-dev.web.app,https://kaiyukan-gacha-hackathon.web.app

.PHONY: deploy deploy-rules typecheck dev logs url help metrics dashboard alerts images-lifecycle ttl-policies logs-agent logs-guard logs-quiz-pool

# #832 運用設定（本番に触れるのでデプロイ後にユーザーが実行する。docs/specs/832-observability-security/tasks.md）
METRICS := agent_runs agent_failures agent_latency agent_input_tokens agent_output_tokens guard_interventions llm_calls error_logs quiz_source quiz_delivery_latency
# アラートの通知先: gcloud beta monitoring channels list で取れる名前（projects/.../notificationChannels/...）
NOTIFICATION_CHANNEL ?=

## Cloud Runへデプロイ（ソースからビルド、secret/env設定込み）
deploy: typecheck
	gcloud run deploy $(SERVICE) \
		--source=. \
		--project=$(PROJECT) \
		--region=$(REGION) \
		--allow-unauthenticated \
		--no-cpu-throttling \
		--set-env-vars="^@^GCS_BUCKET_NAME=$(BUCKET_IMAGES)@LINE_LOGIN_CHANNEL_IDS=$(LINE_LOGIN_CHANNEL_IDS)@AUTH_ALLOWED_ORIGINS=$(AUTH_ALLOWED_ORIGINS)" \
		--set-secrets="LINE_CHANNEL_SECRET=LINE_CHANNEL_SECRET:latest,LINE_CHANNEL_ACCESS_TOKEN=LINE_CHANNEL_ACCESS_TOKEN:latest,GEMINI_API_KEY=GEMINI_API_KEY:latest,EKISPERT_API_ACCESS_KEY=EKISPERT_API_ACCESS_KEY:latest" \
		--quiet
	@echo ""
	@echo "Webhook URL: $$(gcloud run services describe $(SERVICE) --project=$(PROJECT) --region=$(REGION) --format='value(status.url)')/webhook"

## Firestoreセキュリティルールをデプロイ（docs/specs/785-liff-firebase-auth）。要 firebase login
deploy-rules:
	npx firebase-tools deploy --only firestore:rules --project $(PROJECT)

## デプロイ前のtypecheck（deployターゲットから自動実行される）
typecheck:
	npm run typecheck

## ローカル開発サーバー起動
dev:
	npm run dev

## 直近のCloud Runログを表示
logs:
	gcloud logging read 'resource.type=cloud_run_revision AND resource.labels.service_name=$(SERVICE)' \
		--project=$(PROJECT) --limit=30 --freshness=15m

## デプロイ済みのサービスURLを表示
url:
	gcloud run services describe $(SERVICE) --project=$(PROJECT) --region=$(REGION) --format='value(status.url)'

## ログベースの指標を作る（既にあれば更新）
metrics:
	@for m in $(METRICS); do \
		gcloud logging metrics create $$m --config-from-file=ops/metrics/$$m.json --project=$(PROJECT) 2>/dev/null \
		|| gcloud logging metrics update $$m --config-from-file=ops/metrics/$$m.json --project=$(PROJECT); \
	done

## ダッシュボードを1枚作る
dashboard:
	gcloud monitoring dashboards create --config-from-file=ops/dashboard.json --project=$(PROJECT)

## アラートを作る（NOTIFICATION_CHANNEL=projects/.../notificationChannels/... を指定。make metrics の後）
alerts:
	@test -n "$(NOTIFICATION_CHANNEL)" || (echo "NOTIFICATION_CHANNEL を指定してください"; exit 1)
	gcloud alpha monitoring policies create --policy-from-file=ops/alerts/agent-failure-rate.json --notification-channels=$(NOTIFICATION_CHANNEL) --project=$(PROJECT)
	gcloud alpha monitoring policies create --policy-from-file=ops/alerts/error-logs.json --notification-channels=$(NOTIFICATION_CHANNEL) --project=$(PROJECT)

## アップロード写真（line-images/）を7日で自動削除（#832 C8）
images-lifecycle:
	gcloud storage buckets update gs://$(BUCKET_IMAGES) --lifecycle-file=ops/images-lifecycle.json --project=$(PROJECT)

## Firestore の TTL ポリシー（expireAt を過ぎたら自動削除。agentRuns=30日 / webhookEvents=1日）
ttl-policies:
	gcloud firestore fields ttls update expireAt --collection-group=agentRuns --enable-ttl --project=$(PROJECT)
	gcloud firestore fields ttls update expireAt --collection-group=webhookEvents --enable-ttl --project=$(PROJECT)

## エージェントの判断（agent_run）の直近ログ
logs-agent:
	gcloud logging read 'resource.type=cloud_run_revision AND resource.labels.service_name=$(SERVICE) AND jsonPayload.event="agent_run"' \
		--project=$(PROJECT) --limit=20 --freshness=1d --format=json

## コードが介入した（guard）直近ログ
logs-guard:
	gcloud logging read 'resource.type=cloud_run_revision AND resource.labels.service_name=$(SERVICE) AND jsonPayload.event="guard"' \
		--project=$(PROJECT) --limit=20 --freshness=1d --format=json

## 作り置きクイズ（#831）の出題と選択エージェントの直近ログ
logs-quiz-pool:
	gcloud logging read 'resource.type=cloud_run_revision AND resource.labels.service_name=$(SERVICE) AND (jsonPayload.event="quiz_generated" OR jsonPayload.event="quiz_delivered" OR jsonPayload.agent="quiz_pool")' \
		--project=$(PROJECT) --limit=20 --freshness=1d --format=json

help:
	@echo "make deploy      # typecheck後にCloud Runへデプロイ"
	@echo "make deploy-rules # Firestoreセキュリティルールをデプロイ"
	@echo "make typecheck   # 型チェックのみ"
	@echo "make dev         # ローカル開発サーバー起動"
	@echo "make logs        # 直近15分のCloud Runログ"
	@echo "make url         # デプロイ済みサービスURLを表示"
	@echo "make metrics / dashboard / alerts / images-lifecycle / ttl-policies  # #832 運用設定（デプロイ後に実行）"
	@echo "make logs-agent / logs-guard  # エージェントの判断・ガードの直近ログ"
