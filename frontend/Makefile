PROJECT := kaiyukan-gacha-hackathon
BUCKET := kaiyukan-gacha-hackathon-public-assets
BASE_URL := https://storage.googleapis.com/$(BUCKET)
IMAGES_URL := $(BASE_URL)/animals/
GACHA_DEMO_PREFIX := gs://$(BUCKET)/gacha-demo
ANIMALS_PREFIX := gs://$(BUCKET)/animals
HOSTING_DEV_SITE := kaiyukan-gacha-dev
HOSTING_PROD_SITE := kaiyukan-gacha-hackathon

.PHONY: deploy deploy-01 deploy-02 deploy-03 build-liff build-thumbs deploy-liff-dev deploy-liff manifest upload-images upload-manifest open help

## デフォルト: 3バリエーション全部 + 画像 + マニフェストをデプロイ
deploy: manifest upload-images upload-manifest
	gcloud storage cp gacha-demo-01.html $(GACHA_DEMO_PREFIX)/gacha-demo-01.html --project $(PROJECT)
	gcloud storage cp gacha-demo-02.html $(GACHA_DEMO_PREFIX)/gacha-demo-02.html --project $(PROJECT)
	gcloud storage cp gacha-demo-03.html $(GACHA_DEMO_PREFIX)/gacha-demo-03.html --project $(PROJECT)
	@echo ""
	@echo "01: $(BASE_URL)/gacha-demo/gacha-demo-01.html"
	@echo "02: $(BASE_URL)/gacha-demo/gacha-demo-02.html"
	@echo "03: $(BASE_URL)/gacha-demo/gacha-demo-03.html"

## 01（カプセル）だけデプロイ
deploy-01: manifest upload-images upload-manifest
	gcloud storage cp gacha-demo-01.html $(GACHA_DEMO_PREFIX)/gacha-demo-01.html --project $(PROJECT)
	@echo "$(BASE_URL)/gacha-demo/gacha-demo-01.html"

## 02（宝箱）だけデプロイ
deploy-02: manifest upload-images upload-manifest
	gcloud storage cp gacha-demo-02.html $(GACHA_DEMO_PREFIX)/gacha-demo-02.html --project $(PROJECT)
	@echo "$(BASE_URL)/gacha-demo/gacha-demo-02.html"

## 03（水面ジャンプ・レア度選択つき）だけデプロイ
deploy-03: manifest upload-images upload-manifest
	gcloud storage cp gacha-demo-03.html $(GACHA_DEMO_PREFIX)/gacha-demo-03.html --project $(PROJECT)
	@echo "$(BASE_URL)/gacha-demo/gacha-demo-03.html"

## LIFF本番画面（index/gacha/collection/card/zukan + shared/）を Firebase Hosting 用に dist-liff/ へまとめる。
## LINEミニアプリのEndpoint URLは https://kaiyukan-gacha-dev.web.app/（Developing）と
## https://kaiyukan-gacha-hackathon.web.app/（Published）。GCSはディレクトリURLにindex.htmlを返せないためHostingを使う。
build-liff:
	rm -rf dist-liff
	mkdir -p dist-liff
	cp index.html gacha.html collection.html card.html zukan.html dist-liff/
	cp -R shared dist-liff/shared
	$(MAKE) build-thumbs
	cp -R lp-assets dist-liff/lp-assets

## 図鑑用の軽量サムネイル（320px webp）を dist-liff/thumbs/ に作る。元画像は1枚約1.8MBで一覧には重すぎるため。
## 変換結果は .thumbs-cache/ に残して再利用する。cwebp か元画像が無ければ警告だけで続行（図鑑は元画像にフォールバック）
build-thumbs:
	@mkdir -p dist-liff/thumbs .thumbs-cache
	@if ! command -v cwebp >/dev/null 2>&1 || [ ! -d ../images/animals ]; then echo "WARN: cwebp または ../images/animals が無いのでサムネイルを作りません"; exit 0; fi; \
	for f in ../images/animals/*.png; do \
	  id=$$(basename "$$f" | cut -d- -f1); out=.thumbs-cache/$$id.webp; \
	  [ "$$out" -nt "$$f" ] || cwebp -quiet -resize 320 0 -q 78 "$$f" -o "$$out" || exit 1; \
	  cp "$$out" dist-liff/thumbs/$$id.webp; \
	done; echo "thumbs: $$(ls dist-liff/thumbs | wc -l) files"

## 開発用サイト（Developing の LIFF ID）へデプロイ
deploy-liff-dev: build-liff
	npx firebase-tools deploy --only hosting:$(HOSTING_DEV_SITE) --project $(PROJECT)
	@echo "dev: https://$(HOSTING_DEV_SITE).web.app/"

## 本番サイト（Published の LIFF ID）へデプロイ。
## design.md 4.5節・Fableレビュー対応: Firestoreを直接クライアントから読むため、
## #785（Firestoreセキュリティルール整備）が完了するまでは実行しないこと。
## 誤操作防止のため CONFIRM_785_DONE=yes を明示しないと実行しない。
deploy-liff:
ifneq ($(CONFIRM_785_DONE),yes)
	$(error "#785(Firestoreセキュリティルール)が完了するまで deploy-liff は実行しないでください。完了していれば CONFIRM_785_DONE=yes make deploy-liff で実行できます")
endif
	$(MAKE) build-liff
	npx firebase-tools deploy --only hosting:$(HOSTING_PROD_SITE) --project $(PROJECT)
	@echo "prod: https://$(HOSTING_PROD_SITE).web.app/"

## images/animals/ の生成画像を反映した、公開URL埋め込み済みマニフェストを作る
manifest:
	node build-manifest.mjs --base-url=$(IMAGES_URL) --out=dist-cloud/animals-manifest.js

## 生成済みイラストをバケットへアップロード（差分のみ転送）
upload-images:
	gcloud storage rsync ../images/animals $(ANIMALS_PREFIX) --project $(PROJECT)

## クラウド用マニフェストをアップロード
upload-manifest: manifest
	gcloud storage cp dist-cloud/animals-manifest.js $(GACHA_DEMO_PREFIX)/animals-manifest.js --project $(PROJECT)

## 公開中の03をブラウザで開く
open:
	open "$(BASE_URL)/gacha-demo/gacha-demo-03.html"

help:
	@echo "make deploy      # 01/02/03 まとめてデプロイ"
	@echo "make deploy-03   # 03だけデプロイ"
	@echo "make manifest    # ローカルでマニフェストだけ再生成（アップロードなし）"
	@echo "make open        # 公開中の03をブラウザで開く"
	@echo "make deploy-liff-dev                 # LIFF画面を開発用Hostingへデプロイ"
	@echo "CONFIRM_785_DONE=yes make deploy-liff   # LIFF画面を本番Hostingへデプロイ（#785完了後のみ）"
