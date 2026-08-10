---
tags:
- sentence-transformers
- cross-encoder
- reranker
- generated_from_trainer
- dataset_size:100000
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
# [[-4.199  -1.4639  5.2755]
#  [ 5.33   -2.8052 -2.4363]
#  [-5.4459  0.5663  4.0837]
#  [ 5.2864 -3.8402 -0.5809]
#  [ 6.5981 -3.6541 -2.6306]]
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

* Size: 100,000 training samples
* Columns: <code>sentence1</code>, <code>sentence2</code>, and <code>label</code>
* Approximate statistics based on the first 100 samples:
  |          | sentence1                                                                         | sentence2                                                                          | label                                                              |
  |:---------|:----------------------------------------------------------------------------------|:-----------------------------------------------------------------------------------|:-------------------------------------------------------------------|
  | type     | string                                                                            | string                                                                             | int                                                                |
  | modality | text                                                                              | text                                                                               |                                                                    |
  | details  | <ul><li>min: 5 tokens</li><li>mean: 31.79 tokens</li><li>max: 89 tokens</li></ul> | <ul><li>min: 6 tokens</li><li>mean: 22.83 tokens</li><li>max: 209 tokens</li></ul> | <ul><li>0: ~30.77%</li><li>1: ~38.46%</li><li>2: ~30.77%</li></ul> |
* Samples:
  | sentence1                                                                                                                                                                                                                                                                                                                                      | sentence2                                                                                                                                                                                                                                                                                       | label          |
  |:-----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|:------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|:---------------|
  | <code>The final rule revises the prospective payment systems for operating and capital costs for inpatient services under Medicare Part A. Among other things, the final rule adjusts the classifications and weighting factors for diagnosis related groups as required by section 1886(d)(4)(C) of the Social Security Act, 42 U.S.C.</code> | <code>The final rule has nothing to do with payment systems.</code>                                                                                                                                                                                                                             | <code>0</code> |
  | <code>and uh of course there's another aspect of this too uh in terms of invasion of privacy i just thought about it being a professional and of course you probably belong to one or more professional organizations and that is that some of the organizations sell their mailing lists</code>                                               | <code>The mailing lists that you have links to are not sold by any of them.</code>                                                                                                                                                                                                              | <code>0</code> |
  | <code>Worcester, Massachusetts is 40 mi from a capital.</code>                                                                                                                                                                                                                                                                                 | <code>Boston ( pronounced [ ˈbɒstən ] ) is the capital and most populous city of the Commonwealth of Massachusetts in the United States . Worcester, Massachusetts . Worcester is located approximately 40 mi west of Boston , 50 mi east of Springfield and 40 mi north of Providence .</code> | <code>1</code> |
* Loss: [<code>CrossEntropyLoss</code>](https://sbert.net/docs/package_reference/cross_encoder/losses.html#crossentropyloss)

### Evaluation Dataset

#### Unnamed Dataset

* Size: 2,000 evaluation samples
* Columns: <code>sentence1</code>, <code>sentence2</code>, and <code>label</code>
* Approximate statistics based on the first 100 samples:
  |          | sentence1                                                                          | sentence2                                                                         | label                                                              |
  |:---------|:-----------------------------------------------------------------------------------|:----------------------------------------------------------------------------------|:-------------------------------------------------------------------|
  | type     | string                                                                             | string                                                                            | int                                                                |
  | modality | text                                                                               | text                                                                              |                                                                    |
  | details  | <ul><li>min: 5 tokens</li><li>mean: 26.87 tokens</li><li>max: 135 tokens</li></ul> | <ul><li>min: 6 tokens</li><li>mean: 13.24 tokens</li><li>max: 26 tokens</li></ul> | <ul><li>0: ~32.69%</li><li>1: ~36.54%</li><li>2: ~30.77%</li></ul> |
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
<details><summary>Click to expand</summary>

| Epoch   | Step      | Training Loss | Validation Loss |
|:-------:|:---------:|:-------------:|:---------------:|
| 0.004   | 50        | 1.3213        | -               |
| 0.008   | 100       | 1.3814        | -               |
| 0.012   | 150       | 1.0622        | -               |
| 0.016   | 200       | 0.9419        | -               |
| 0.02    | 250       | 0.7108        | -               |
| 0.024   | 300       | 0.7851        | -               |
| 0.028   | 350       | 0.5646        | -               |
| 0.032   | 400       | 0.4877        | -               |
| 0.036   | 450       | 0.4797        | -               |
| 0.04    | 500       | 0.3936        | -               |
| 0.044   | 550       | 0.4251        | -               |
| 0.048   | 600       | 0.4176        | -               |
| 0.052   | 650       | 0.4604        | -               |
| 0.056   | 700       | 0.5349        | -               |
| 0.06    | 750       | 0.4553        | -               |
| 0.064   | 800       | 0.4113        | -               |
| 0.068   | 850       | 0.3542        | -               |
| 0.072   | 900       | 0.3886        | -               |
| 0.076   | 950       | 0.3715        | -               |
| 0.08    | 1000      | 0.4025        | -               |
| 0.084   | 1050      | 0.3992        | -               |
| 0.088   | 1100      | 0.4393        | -               |
| 0.092   | 1150      | 0.3417        | -               |
| 0.096   | 1200      | 0.4496        | -               |
| 0.1     | 1250      | 0.4464        | -               |
| 0.104   | 1300      | 0.4364        | -               |
| 0.108   | 1350      | 0.3392        | -               |
| 0.112   | 1400      | 0.3578        | -               |
| 0.116   | 1450      | 0.4159        | -               |
| 0.12    | 1500      | 0.4600        | -               |
| 0.124   | 1550      | 0.4344        | -               |
| 0.128   | 1600      | 0.3710        | -               |
| 0.132   | 1650      | 0.4244        | -               |
| 0.136   | 1700      | 0.4533        | -               |
| 0.14    | 1750      | 0.3933        | -               |
| 0.144   | 1800      | 0.3607        | -               |
| 0.148   | 1850      | 0.4157        | -               |
| 0.152   | 1900      | 0.4148        | -               |
| 0.156   | 1950      | 0.4701        | -               |
| 0.16    | 2000      | 0.4239        | -               |
| 0.164   | 2050      | 0.3449        | -               |
| 0.168   | 2100      | 0.4551        | -               |
| 0.172   | 2150      | 0.4120        | -               |
| 0.176   | 2200      | 0.3293        | -               |
| 0.18    | 2250      | 0.3422        | -               |
| 0.184   | 2300      | 0.4350        | -               |
| 0.188   | 2350      | 0.4375        | -               |
| 0.192   | 2400      | 0.3155        | -               |
| 0.196   | 2450      | 0.4077        | -               |
| 0.2     | 2500      | 0.3913        | -               |
| 0.204   | 2550      | 0.3616        | -               |
| 0.208   | 2600      | 0.3173        | -               |
| 0.212   | 2650      | 0.4389        | -               |
| 0.216   | 2700      | 0.3512        | -               |
| 0.22    | 2750      | 0.3673        | -               |
| 0.224   | 2800      | 0.4021        | -               |
| 0.228   | 2850      | 0.3492        | -               |
| 0.232   | 2900      | 0.4058        | -               |
| 0.236   | 2950      | 0.3206        | -               |
| 0.24    | 3000      | 0.3910        | -               |
| 0.244   | 3050      | 0.3423        | -               |
| 0.248   | 3100      | 0.3274        | -               |
| 0.252   | 3150      | 0.4596        | -               |
| 0.256   | 3200      | 0.3669        | -               |
| 0.26    | 3250      | 0.3493        | -               |
| 0.264   | 3300      | 0.3571        | -               |
| 0.268   | 3350      | 0.3669        | -               |
| 0.272   | 3400      | 0.3051        | -               |
| 0.276   | 3450      | 0.3240        | -               |
| 0.28    | 3500      | 0.4007        | -               |
| 0.284   | 3550      | 0.4347        | -               |
| 0.288   | 3600      | 0.3072        | -               |
| 0.292   | 3650      | 0.3816        | -               |
| 0.296   | 3700      | 0.4224        | -               |
| 0.3     | 3750      | 0.4166        | -               |
| 0.304   | 3800      | 0.3895        | -               |
| 0.308   | 3850      | 0.4010        | -               |
| 0.312   | 3900      | 0.3761        | -               |
| 0.316   | 3950      | 0.3277        | -               |
| 0.32    | 4000      | 0.3468        | -               |
| 0.324   | 4050      | 0.3816        | -               |
| 0.328   | 4100      | 0.3473        | -               |
| 0.332   | 4150      | 0.3304        | -               |
| 0.336   | 4200      | 0.3625        | -               |
| 0.34    | 4250      | 0.3558        | -               |
| 0.344   | 4300      | 0.4794        | -               |
| 0.348   | 4350      | 0.2743        | -               |
| 0.352   | 4400      | 0.4905        | -               |
| 0.356   | 4450      | 0.3735        | -               |
| 0.36    | 4500      | 0.2951        | -               |
| 0.364   | 4550      | 0.3746        | -               |
| 0.368   | 4600      | 0.3422        | -               |
| 0.372   | 4650      | 0.4555        | -               |
| 0.376   | 4700      | 0.3273        | -               |
| 0.38    | 4750      | 0.3726        | -               |
| 0.384   | 4800      | 0.4459        | -               |
| 0.388   | 4850      | 0.3455        | -               |
| 0.392   | 4900      | 0.3511        | -               |
| 0.396   | 4950      | 0.3434        | -               |
| 0.4     | 5000      | 0.4114        | -               |
| 0.404   | 5050      | 0.3564        | -               |
| 0.408   | 5100      | 0.3686        | -               |
| 0.412   | 5150      | 0.3024        | -               |
| 0.416   | 5200      | 0.4470        | -               |
| 0.42    | 5250      | 0.3414        | -               |
| 0.424   | 5300      | 0.3849        | -               |
| 0.428   | 5350      | 0.4196        | -               |
| 0.432   | 5400      | 0.4518        | -               |
| 0.436   | 5450      | 0.2704        | -               |
| 0.44    | 5500      | 0.3977        | -               |
| 0.444   | 5550      | 0.3918        | -               |
| 0.448   | 5600      | 0.3296        | -               |
| 0.452   | 5650      | 0.3935        | -               |
| 0.456   | 5700      | 0.2701        | -               |
| 0.46    | 5750      | 0.3071        | -               |
| 0.464   | 5800      | 0.3458        | -               |
| 0.468   | 5850      | 0.4168        | -               |
| 0.472   | 5900      | 0.3830        | -               |
| 0.476   | 5950      | 0.3441        | -               |
| 0.48    | 6000      | 0.3866        | -               |
| 0.484   | 6050      | 0.4051        | -               |
| 0.488   | 6100      | 0.3869        | -               |
| 0.492   | 6150      | 0.4218        | -               |
| 0.496   | 6200      | 0.4131        | -               |
| 0.5     | 6250      | 0.3997        | -               |
| 0.504   | 6300      | 0.3886        | -               |
| 0.508   | 6350      | 0.2904        | -               |
| 0.512   | 6400      | 0.3492        | -               |
| 0.516   | 6450      | 0.3705        | -               |
| 0.52    | 6500      | 0.3157        | -               |
| 0.524   | 6550      | 0.3962        | -               |
| 0.528   | 6600      | 0.5045        | -               |
| 0.532   | 6650      | 0.2373        | -               |
| 0.536   | 6700      | 0.4996        | -               |
| 0.54    | 6750      | 0.3872        | -               |
| 0.544   | 6800      | 0.3348        | -               |
| 0.548   | 6850      | 0.2908        | -               |
| 0.552   | 6900      | 0.3872        | -               |
| 0.556   | 6950      | 0.3399        | -               |
| 0.56    | 7000      | 0.3519        | -               |
| 0.564   | 7050      | 0.4277        | -               |
| 0.568   | 7100      | 0.3690        | -               |
| 0.572   | 7150      | 0.3483        | -               |
| 0.576   | 7200      | 0.3930        | -               |
| 0.58    | 7250      | 0.4089        | -               |
| 0.584   | 7300      | 0.3273        | -               |
| 0.588   | 7350      | 0.2588        | -               |
| 0.592   | 7400      | 0.4172        | -               |
| 0.596   | 7450      | 0.3112        | -               |
| 0.6     | 7500      | 0.3849        | -               |
| 0.604   | 7550      | 0.2664        | -               |
| 0.608   | 7600      | 0.4646        | -               |
| 0.612   | 7650      | 0.3817        | -               |
| 0.616   | 7700      | 0.3612        | -               |
| 0.62    | 7750      | 0.3143        | -               |
| 0.624   | 7800      | 0.3395        | -               |
| 0.628   | 7850      | 0.4354        | -               |
| 0.632   | 7900      | 0.3742        | -               |
| 0.636   | 7950      | 0.4290        | -               |
| 0.64    | 8000      | 0.3191        | -               |
| 0.644   | 8050      | 0.3234        | -               |
| 0.648   | 8100      | 0.2908        | -               |
| 0.652   | 8150      | 0.3067        | -               |
| 0.656   | 8200      | 0.3724        | -               |
| 0.66    | 8250      | 0.3741        | -               |
| 0.664   | 8300      | 0.4017        | -               |
| 0.668   | 8350      | 0.3081        | -               |
| 0.672   | 8400      | 0.2997        | -               |
| 0.676   | 8450      | 0.3562        | -               |
| 0.68    | 8500      | 0.3846        | -               |
| 0.684   | 8550      | 0.3376        | -               |
| 0.688   | 8600      | 0.3143        | -               |
| 0.692   | 8650      | 0.3740        | -               |
| 0.696   | 8700      | 0.3365        | -               |
| 0.7     | 8750      | 0.4490        | -               |
| 0.704   | 8800      | 0.3377        | -               |
| 0.708   | 8850      | 0.2759        | -               |
| 0.712   | 8900      | 0.2497        | -               |
| 0.716   | 8950      | 0.3075        | -               |
| 0.72    | 9000      | 0.2959        | -               |
| 0.724   | 9050      | 0.2918        | -               |
| 0.728   | 9100      | 0.4693        | -               |
| 0.732   | 9150      | 0.3899        | -               |
| 0.736   | 9200      | 0.3153        | -               |
| 0.74    | 9250      | 0.4267        | -               |
| 0.744   | 9300      | 0.3149        | -               |
| 0.748   | 9350      | 0.3557        | -               |
| 0.752   | 9400      | 0.4602        | -               |
| 0.756   | 9450      | 0.2889        | -               |
| 0.76    | 9500      | 0.4513        | -               |
| 0.764   | 9550      | 0.3221        | -               |
| 0.768   | 9600      | 0.2919        | -               |
| 0.772   | 9650      | 0.3542        | -               |
| 0.776   | 9700      | 0.3098        | -               |
| 0.78    | 9750      | 0.2825        | -               |
| 0.784   | 9800      | 0.3691        | -               |
| 0.788   | 9850      | 0.3354        | -               |
| 0.792   | 9900      | 0.4568        | -               |
| 0.796   | 9950      | 0.4172        | -               |
| 0.8     | 10000     | 0.3045        | -               |
| 0.804   | 10050     | 0.3708        | -               |
| 0.808   | 10100     | 0.3458        | -               |
| 0.812   | 10150     | 0.3053        | -               |
| 0.816   | 10200     | 0.3503        | -               |
| 0.82    | 10250     | 0.3012        | -               |
| 0.824   | 10300     | 0.3091        | -               |
| 0.828   | 10350     | 0.2998        | -               |
| 0.832   | 10400     | 0.3864        | -               |
| 0.836   | 10450     | 0.3467        | -               |
| 0.84    | 10500     | 0.3867        | -               |
| 0.844   | 10550     | 0.3440        | -               |
| 0.848   | 10600     | 0.3009        | -               |
| 0.852   | 10650     | 0.3925        | -               |
| 0.856   | 10700     | 0.3007        | -               |
| 0.86    | 10750     | 0.3040        | -               |
| 0.864   | 10800     | 0.3328        | -               |
| 0.868   | 10850     | 0.3379        | -               |
| 0.872   | 10900     | 0.3571        | -               |
| 0.876   | 10950     | 0.3138        | -               |
| 0.88    | 11000     | 0.4419        | -               |
| 0.884   | 11050     | 0.4273        | -               |
| 0.888   | 11100     | 0.3228        | -               |
| 0.892   | 11150     | 0.4154        | -               |
| 0.896   | 11200     | 0.3345        | -               |
| 0.9     | 11250     | 0.3518        | -               |
| 0.904   | 11300     | 0.3845        | -               |
| 0.908   | 11350     | 0.2641        | -               |
| 0.912   | 11400     | 0.2953        | -               |
| 0.916   | 11450     | 0.3563        | -               |
| 0.92    | 11500     | 0.3293        | -               |
| 0.924   | 11550     | 0.3122        | -               |
| 0.928   | 11600     | 0.2588        | -               |
| 0.932   | 11650     | 0.3227        | -               |
| 0.936   | 11700     | 0.4409        | -               |
| 0.94    | 11750     | 0.2906        | -               |
| 0.944   | 11800     | 0.3265        | -               |
| 0.948   | 11850     | 0.4193        | -               |
| 0.952   | 11900     | 0.3858        | -               |
| 0.956   | 11950     | 0.3699        | -               |
| 0.96    | 12000     | 0.2696        | -               |
| 0.964   | 12050     | 0.3636        | -               |
| 0.968   | 12100     | 0.2614        | -               |
| 0.972   | 12150     | 0.4334        | -               |
| 0.976   | 12200     | 0.3043        | -               |
| 0.98    | 12250     | 0.3487        | -               |
| 0.984   | 12300     | 0.2694        | -               |
| 0.988   | 12350     | 0.3741        | -               |
| 0.992   | 12400     | 0.2711        | -               |
| 0.996   | 12450     | 0.3567        | -               |
| **1.0** | **12500** | **0.3326**    | **0.4074**      |

* The bold row denotes the saved checkpoint.
</details>

### Training Time
- **Training**: 10.3 hours
- **Evaluation**: 20.3 seconds
- **Total**: 10.3 hours

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