docker stop tokenproxy
docker rm tokenproxy
docker build -t tokenproxy .
docker run -d --name tokenproxy -p 127.0.0.1:20128 --env-file .env -v tokenproxy-data:/app/data tokenproxy