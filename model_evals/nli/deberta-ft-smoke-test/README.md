---
tags:
- sentence-transformers
- cross-encoder
- reranker
- generated_from_trainer
- dataset_size:256
- loss:CrossEntropyLoss
base_model: cross-encoder/nli-deberta-v3-base
pipeline_tag: text-classification
library_name: sentence-transformers
---

# CrossEncoder based on cross-encoder/nli-deberta-v3-base

This is a [Cross Encoder](https://www.sbert.net/docs/cross_encoder/usage/usage.html) model finetuned from [cross-encoder/nli-deberta-v3-base](https://huggingface.co/cross-encoder/nli-deberta-v3-base) using the [sentence-transformers](https://www.SBERT.net) library. It computes scores for pairs of texts, which can be used for text pair classification.

## Model Details

### Model Description
- **Model Type:** Cross Encoder
- **Base model:** [cross-encoder/nli-deberta-v3-base](https://huggingface.co/cross-encoder/nli-deberta-v3-base) <!-- at revision 6c749ce3425cd33b46d187e45b92bbf96ee12ec7 -->
- **Maximum Sequence Length:** 512 tokens
- **Number of Output Labels:** 3 labels
- **Supported Modality:** Text
<!-- - **Training Dataset:** Unknown -->
<!-- - **Language:** Unknown -->
<!-- - **License:** Unknown -->

### Model Sources

- **Documentation:** [Sentence Transformers Documentation](https://sbert.net)
- **Documentation:** [Cross Encoder Documentation](https://www.sbert.net/docs/cross_encoder/usage/usage.html)
- **Repository:** [Sentence Transformers on GitHub](https://github.com/huggingface/sentence-transformers)
- **Hugging Face:** [Cross Encoders on Hugging Face](https://huggingface.co/models?library=sentence-transformers&other=cross-encoder)

### Full Model Architecture

```
CrossEncoder(
  (0): Transformer({'transformer_task': 'sequence-classification', 'modality_config': {'text': {'method': 'forward', 'method_output_name': 'logits'}}, 'module_output_name': 'scores', 'architecture': 'DebertaV2ForSequenceClassification'})
)
```

## Usage

### Direct Usage (Sentence Transformers)

First install the Sentence Transformers library:

```bash
pip install -U sentence-transformers
```

Then you can load this model and run inference.
```python
from sentence_transformers import CrossEncoder

# Download from the 🤗 Hub
model = CrossEncoder("cross_encoder_model_id")
# Get scores for pairs of inputs
pairs = [
    ['The new rights are nice enough', 'Everyone really likes the newest benefits'],
    ['This site includes a list of all award winners and a searchable database of Government Executive articles.', 'The Government Executive articles housed on the website are not able to be searched.'],
    ["uh i don't know i i have mixed emotions about him uh sometimes i like him but at the same times i love to see somebody beat him", 'I like him for the most part, but would still enjoy seeing someone beat him.'],
    ["yeah i i think my favorite restaurant is always been the one closest  you know the closest as long as it's it meets the minimum criteria you know of good food", 'My favorite restaurants are always at least a hundred miles away from my house.'],
    ["i don't know um do you do a lot of camping", 'I know exactly.'],
]
scores = model.predict(pairs)
print(scores)
# [[-3.7954 -1.2168  4.6143]
#  [ 6.7622 -3.7771 -2.6226]
#  [-7.3355  3.3068  2.8877]
#  [ 6.1182 -3.7955 -1.7208]
#  [ 7.0781 -4.1166 -2.4651]]
```

<!--
### Direct Usage (Transformers)

<details><summary>Click to see the direct usage in Transformers</summary>

</details>
-->

<!--
### Downstream Usage (Sentence Transformers)

You can finetune this model on your own dataset.

<details><summary>Click to expand</summary>

</details>
-->

<!--
### Out-of-Scope Use

*List how the model may foreseeably be misused and address what users ought not to do with the model.*
-->

<!--
## Bias, Risks and Limitations

*What are the known or foreseeable issues stemming from this model? You could also flag here known failure cases or weaknesses of the model.*
-->

<!--
### Recommendations

*What are recommendations with respect to the foreseeable issues? For example, filtering explicit content.*
-->

## Training Details

### Training Dataset

#### Unnamed Dataset

* Size: 256 training samples
* Columns: <code>sentence1</code>, <code>sentence2</code>, and <code>label</code>
* Approximate statistics based on the first 100 samples:
  |          | sentence1                                                                          | sentence2                                                                          | label                                                              |
  |:---------|:-----------------------------------------------------------------------------------|:-----------------------------------------------------------------------------------|:-------------------------------------------------------------------|
  | type     | string                                                                             | string                                                                             | int                                                                |
  | modality | text                                                                               | text                                                                               |                                                                    |
  | details  | <ul><li>min: 6 tokens</li><li>mean: 35.45 tokens</li><li>max: 128 tokens</li></ul> | <ul><li>min: 7 tokens</li><li>mean: 20.47 tokens</li><li>max: 149 tokens</li></ul> | <ul><li>0: ~21.15%</li><li>1: ~49.04%</li><li>2: ~29.81%</li></ul> |
* Samples:
  | sentence1                                                                                                                                                                                                                                                                                                                          | sentence2                                                             | label          |
  |:-----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|:----------------------------------------------------------------------|:---------------|
  | <code>How do you know? All this is their information again.</code>                                                                                                                                                                                                                                                                 | <code>They hold the reins of this information.</code>                 | <code>1</code> |
  | <code>At the end of Rue des Francs-Bourgeois is what many consider to be the city's most handsome residential square, the Place des Vosges, with its stone and red brick facades.</code>                                                                                                                                           | <code>Place des Vosges is constructed entirely of gray marble.</code> | <code>0</code> |
  | <code>Paul Beard (4 August 1901 – 22 April 1989) was an English violinist, known particularly as leader of Sir Thomas Beecham's original London Philharmonic Orchestra and Sir Adrian Boult's BBC Symphony Orchestra. He was also a teacher, holding posts at the Royal Academy of Music and the Guildhall School of Music.</code> | <code>Paul Beard was a teacher most his life</code>                   | <code>2</code> |
* Loss: [<code>CrossEntropyLoss</code>](https://sbert.net/docs/package_reference/cross_encoder/losses.html#crossentropyloss)

### Evaluation Dataset

#### Unnamed Dataset

* Size: 64 evaluation samples
* Columns: <code>sentence1</code>, <code>sentence2</code>, and <code>label</code>
* Approximate statistics based on the first 64 samples:
  |          | sentence1                                                                          | sentence2                                                                         | label                                                              |
  |:---------|:-----------------------------------------------------------------------------------|:----------------------------------------------------------------------------------|:-------------------------------------------------------------------|
  | type     | string                                                                             | string                                                                            | int                                                                |
  | modality | text                                                                               | text                                                                              |                                                                    |
  | details  | <ul><li>min: 7 tokens</li><li>mean: 28.86 tokens</li><li>max: 135 tokens</li></ul> | <ul><li>min: 6 tokens</li><li>mean: 13.22 tokens</li><li>max: 26 tokens</li></ul> | <ul><li>0: ~35.94%</li><li>1: ~31.25%</li><li>2: ~32.81%</li></ul> |
* Samples:
  | sentence1                                                                                                                                    | sentence2                                                                                         | label          |
  |:---------------------------------------------------------------------------------------------------------------------------------------------|:--------------------------------------------------------------------------------------------------|:---------------|
  | <code>The new rights are nice enough</code>                                                                                                  | <code>Everyone really likes the newest benefits</code>                                            | <code>2</code> |
  | <code>This site includes a list of all award winners and a searchable database of Government Executive articles.</code>                      | <code>The Government Executive articles housed on the website are not able to be searched.</code> | <code>0</code> |
  | <code>uh i don't know i i have mixed emotions about him uh sometimes i like him but at the same times i love to see somebody beat him</code> | <code>I like him for the most part, but would still enjoy seeing someone beat him.</code>         | <code>1</code> |
* Loss: [<code>CrossEntropyLoss</code>](https://sbert.net/docs/package_reference/cross_encoder/losses.html#crossentropyloss)

### Training Hyperparameters
#### Non-Default Hyperparameters

- `num_train_epochs`: 1
- `learning_rate`: 1e-05
- `warmup_steps`: 0.1
- `load_best_model_at_end`: True

#### All Hyperparameters
<details><summary>Click to expand</summary>

- `per_device_train_batch_size`: 8
- `num_train_epochs`: 1
- `max_steps`: -1
- `learning_rate`: 1e-05
- `lr_scheduler_type`: linear
- `lr_scheduler_kwargs`: None
- `warmup_steps`: 0.1
- `optim`: adamw_torch_fused
- `optim_args`: None
- `weight_decay`: 0.0
- `adam_beta1`: 0.9
- `adam_beta2`: 0.999
- `adam_epsilon`: 1e-08
- `optim_target_modules`: None
- `gradient_accumulation_steps`: 1
- `average_tokens_across_devices`: True
- `max_grad_norm`: 1.0
- `label_smoothing_factor`: 0.0
- `bf16`: False
- `fp16`: False
- `bf16_full_eval`: False
- `fp16_full_eval`: False
- `tf32`: None
- `gradient_checkpointing`: False
- `gradient_checkpointing_kwargs`: None
- `torch_compile`: False
- `torch_compile_backend`: None
- `torch_compile_mode`: None
- `use_liger_kernel`: False
- `liger_kernel_config`: None
- `use_cache`: False
- `neftune_noise_alpha`: None
- `torch_empty_cache_steps`: None
- `auto_find_batch_size`: False
- `log_on_each_node`: True
- `logging_nan_inf_filter`: True
- `include_num_input_tokens_seen`: no
- `log_level`: passive
- `log_level_replica`: warning
- `disable_tqdm`: False
- `project`: huggingface
- `trackio_space_id`: None
- `trackio_bucket_id`: None
- `trackio_static_space_id`: None
- `per_device_eval_batch_size`: 8
- `prediction_loss_only`: True
- `eval_on_start`: False
- `eval_do_concat_batches`: True
- `eval_use_gather_object`: False
- `eval_accumulation_steps`: None
- `include_for_metrics`: []
- `batch_eval_metrics`: False
- `save_only_model`: False
- `save_on_each_node`: False
- `enable_jit_checkpoint`: False
- `push_to_hub`: False
- `hub_private_repo`: None
- `hub_model_id`: None
- `hub_strategy`: every_save
- `hub_always_push`: False
- `hub_revision`: None
- `load_best_model_at_end`: True
- `ignore_data_skip`: False
- `restore_callback_states_from_checkpoint`: False
- `full_determinism`: False
- `seed`: 42
- `data_seed`: None
- `use_cpu`: False
- `accelerator_config`: {'split_batches': False, 'dispatch_batches': None, 'even_batches': True, 'use_seedable_sampler': True, 'non_blocking': False, 'gradient_accumulation_kwargs': None}
- `parallelism_config`: None
- `dataloader_drop_last`: False
- `dataloader_num_workers`: 0
- `dataloader_pin_memory`: True
- `dataloader_persistent_workers`: False
- `dataloader_prefetch_factor`: None
- `remove_unused_columns`: True
- `label_names`: None
- `train_sampling_strategy`: random
- `length_column_name`: length
- `ddp_find_unused_parameters`: None
- `ddp_bucket_cap_mb`: None
- `ddp_broadcast_buffers`: False
- `ddp_static_graph`: None
- `ddp_backend`: None
- `ddp_timeout`: 1800
- `fsdp`: None
- `fsdp_config`: None
- `deepspeed`: None
- `debug`: []
- `skip_memory_metrics`: True
- `do_predict`: False
- `resume_from_checkpoint`: None
- `warmup_ratio`: None
- `local_rank`: -1
- `prompts`: None
- `batch_sampler`: batch_sampler
- `multi_dataset_batch_sampler`: proportional
- `router_mapping`: {}
- `learning_rate_mapping`: {}

</details>

### Training Logs
| Epoch   | Step   | Validation Loss |
|:-------:|:------:|:---------------:|
| **1.0** | **32** | **0.5257**      |

* The bold row denotes the saved checkpoint.

### Training Time
- **Training**: 1.5 minutes
- **Evaluation**: 2.9 seconds
- **Total**: 1.6 minutes

### Framework Versions
- Python: 3.14.6
- Sentence Transformers: 5.7.0
- Transformers: 5.14.1
- PyTorch: 2.13.0
- Accelerate: 1.14.0
- Datasets: 5.0.1
- Tokenizers: 0.22.2

## Additional Resources

- [Training and Finetuning Reranker Models with Sentence Transformers](https://huggingface.co/blog/train-reranker): the end-to-end guide for training or finetuning Cross Encoder (reranker) models.
- [Multimodal Embedding & Reranker Models with Sentence Transformers](https://huggingface.co/blog/multimodal-sentence-transformers): use text, image, audio, and video reranker models through the same API.
- [Training and Finetuning Multimodal Embedding & Reranker Models with Sentence Transformers](https://huggingface.co/blog/train-multimodal-sentence-transformers): training multimodal Cross Encoders.

## Citation

### BibTeX

#### Sentence Transformers
```bibtex
@inproceedings{reimers-2019-sentence-bert,
    title = "Sentence-BERT: Sentence Embeddings using Siamese BERT-Networks",
    author = "Reimers, Nils and Gurevych, Iryna",
    booktitle = "Proceedings of the 2019 Conference on Empirical Methods in Natural Language Processing",
    month = "11",
    year = "2019",
    publisher = "Association for Computational Linguistics",
    url = "https://arxiv.org/abs/1908.10084",
}
```

<!--
## Glossary

*Clearly define terms in order to be accessible across audiences.*
-->

<!--
## Model Card Authors

*Lists the people who create the model card, providing recognition and accountability for the detailed work that goes into its construction.*
-->

<!--
## Model Card Contact

*Provides a way for people who have updates to the Model Card, suggestions, or questions, to contact the Model Card authors.*
-->